"""Checks for archive intake and procurement risk triage."""

import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from app.services.archive_store import ArchiveStore
from app.services.data_intake import (
    compare_manifests,
    compare_record_changes,
    detect_risks,
    parse_archive,
)


def make_archive(files: dict[str, str]) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return stream.getvalue()


class DataIntakeTests(unittest.TestCase):
    def test_parses_csv_and_flags_confirmed_quantity_shortfall(self) -> None:
        documents = parse_archive(
            make_archive(
                {
                    "orders/po.csv": (
                        "PO Number,Ordered Quantity,Confirmed Quantity,Supplier\n"
                        "PO-42,100,80,Acme\n"
                    )
                }
            )
        )

        risks = detect_risks(documents)

        self.assertEqual(len(documents), 1)
        self.assertEqual(len(risks), 1)
        self.assertIn("PO quantity is 100", risks[0]["action"])
        self.assertIn("row 2", risks[0]["evidence"])

    def test_flags_bank_change_in_chinese_text_as_critical(self) -> None:
        documents = parse_archive(
            make_archive({"supplier/change.txt": "供应商通知：更改银行账户"})
        )

        risks = detect_risks(documents)

        self.assertEqual(risks[0]["severity"], "critical")
        self.assertIn("verify out of band", risks[0]["title"])

    def test_matches_quantity_columns_in_chinese(self) -> None:
        documents = parse_archive(
            make_archive({"orders.csv": "订购数量,确认数量\n100,90\n"})
        )

        risks = detect_risks(documents)

        self.assertEqual(len(risks), 1)
        self.assertIn("confirmed less", risks[0]["title"])

    def test_detects_semicolon_delimited_csv(self) -> None:
        documents = parse_archive(
            make_archive(
                {"orders.csv": "Ordered Quantity;Confirmed Quantity\n100;80\n"}
            )
        )

        risks = detect_risks(documents)

        self.assertEqual(len(risks), 1)
        self.assertIn("confirmed less", risks[0]["title"])

    def test_compares_new_changed_and_removed_files(self) -> None:
        changes = compare_manifests(
            {"a.csv": "old", "removed.txt": "same"},
            {"a.csv": "new", "b.csv": "added"},
        )

        self.assertEqual(
            {item["kind"] for item in changes}, {"changed", "new", "removed"}
        )

    def test_archive_store_detects_supplier_bank_detail_change(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            store = ArchiveStore(Path(temporary_directory))
            first = make_archive({"suppliers.csv": "Supplier ID,IBAN\nS-1,DE001\n"})
            second = make_archive({"suppliers.csv": "Supplier ID,IBAN\nS-1,DE002\n"})
            store.import_archive(first)
            result = store.import_archive(second)

            summary = store.summary()
            self.assertGreater(result["changed_count"], 0)
            self.assertTrue(
                any(change["kind"] == "risk" for change in summary["events"])
            )
            self.assertTrue(
                any(risk["severity"] == "critical" for risk in summary["risks"])
            )

    def test_detects_changed_eta_for_a_stable_purchase_order(self) -> None:
        before = parse_archive(
            make_archive({"orders.csv": "PO Number,SKU,ETA\nPO-9,BOX-1,2026-11-20\n"})
        )
        after = parse_archive(
            make_archive({"orders.csv": "PO Number,SKU,ETA\nPO-9,BOX-1,2026-11-23\n"})
        )

        events = compare_record_changes(before, after)

        self.assertEqual(len(events), 1)
        self.assertIn("eta", events[0]["summary"])

    def test_rejects_non_zip_input(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid .zip"):
            parse_archive(b"not a zip")

    def test_keeps_unrecognized_file_visible_with_warning(self) -> None:
        documents = parse_archive(make_archive({"scans/receipt.tif": "sample"}))

        self.assertEqual(len(documents), 1)
        self.assertIn("needs OCR", documents[0].warning)

    def test_extracts_supplier_email_body(self) -> None:
        email = (
            "From: supplier@example.test\n"
            "Subject: Port delay\n"
            "Content-Type: text/plain; charset=utf-8\n\n"
            "Shipment delayed due to port closure."
        )
        documents = parse_archive(make_archive({"supplier/update.eml": email}))

        self.assertIn("port closure", documents[0].text)
        self.assertTrue(detect_risks(documents))

    def test_normalizes_portal_archive_root(self) -> None:
        documents = parse_archive(
            make_archive({"soony-data/soony/master/products.csv": "sku\nFG-1\n"})
        )

        self.assertEqual(documents[0].path, "soony/master/products.csv")

    def test_incremental_portal_snapshot_reuses_unchanged_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            store = ArchiveStore(Path(temporary_directory))
            first_content = b"sku\nFG-1\n"
            second_content = b"sku\nFG-2\n"
            first_hash = hashlib.sha256(first_content).hexdigest()
            second_hash = hashlib.sha256(second_content).hexdigest()
            store.commit_remote_files(
                {"soony/master/products.csv": first_hash},
                {"soony/master/products.csv": first_content},
            )

            no_change = store.commit_remote_files(
                {"soony/master/products.csv": first_hash}, {}
            )
            changed = store.commit_remote_files(
                {"soony/master/products.csv": second_hash},
                {"soony/master/products.csv": second_content},
            )

            self.assertEqual(no_change["changed_count"], 0)
            self.assertEqual(changed["changed_count"], 1)

    def test_incremental_portal_snapshot_tracks_removed_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            store = ArchiveStore(Path(temporary_directory))
            retained = b"sku\nFG-1\n"
            removed = b"note\nold\n"
            store.commit_remote_files(
                {
                    "soony/master/products.csv": hashlib.sha256(retained).hexdigest(),
                    "soony/context/old.txt": hashlib.sha256(removed).hexdigest(),
                },
                {
                    "soony/master/products.csv": retained,
                    "soony/context/old.txt": removed,
                },
            )

            result = store.commit_remote_files(
                {"soony/master/products.csv": hashlib.sha256(retained).hexdigest()},
                {},
            )

            self.assertEqual(result["changed_count"], 1)
            self.assertEqual(result["changes"][0]["kind"], "removed")


if __name__ == "__main__":
    unittest.main()
