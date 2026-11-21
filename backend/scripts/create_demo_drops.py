"""Create two synthetic portal snapshots for a safe local demo."""

import csv
import io
import zipfile
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parents[1] / ".local_data" / "demo_drops"


def csv_text(rows: list[list[str]]) -> str:
    """Serialize rows as UTF-8 CSV text."""
    stream = io.StringIO(newline="")
    csv.writer(stream).writerows(rows)
    return stream.getvalue()


def write_drop(name: str, files: dict[str, str]) -> Path:
    """Write a synthetic Soony-like ZIP snapshot."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_DIR / name
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return target


def main() -> None:
    """Build baseline and changed snapshots used in the UI demo."""
    headers = [
        "PO Number",
        "Supplier ID",
        "Supplier Name",
        "SKU",
        "Ordered Quantity",
        "Confirmed Quantity",
        "Received Quantity",
        "Required Quantity",
        "Available Quantity",
        "ETA",
        "Status",
    ]
    suppliers_1 = csv_text(
        [
            ["Supplier ID", "Supplier Name", "IBAN"],
            ["S-01", "Acme Packaging", "DE89370400440532013000"],
        ]
    )
    suppliers_2 = suppliers_1.replace(
        "DE89370400440532013000", "DE12500105170648489890"
    )
    orders_1 = csv_text(
        [
            headers,
            [
                "PO-1042", "S-01", "Acme Packaging", "BOX-1", "10000", "10000",
                "0", "10000", "8500", "2026-11-22", "Confirmed",
            ],
        ]
    )
    orders_2 = csv_text(
        [
            headers,
            [
                "PO-1042", "S-01", "Acme Packaging", "BOX-1", "10000", "8500",
                "0", "10000", "7000", "2026-11-23", "Delayed",
            ],
        ]
    )
    notice_1 = "Port bulletin: Typhoon Kong-rey is disrupting sailings from Taiwan."
    notice_2 = (
        "Port bulletin: Typhoon Kong-rey caused port congestion and a missed "
        "vessel cutoff."
    )

    first = write_drop(
        "drop_1.zip",
        {
            "orders/purchase_orders.csv": orders_1,
            "suppliers/supplier_master.csv": suppliers_1,
            "logistics/port_notice.txt": notice_1,
        },
    )
    second = write_drop(
        "drop_2.zip",
        {
            "orders/purchase_orders.csv": orders_2,
            "suppliers/supplier_master.csv": suppliers_2,
            "logistics/port_notice.txt": notice_2,
        },
    )
    print(f"Created synthetic demo drops:\n{first}\n{second}")


if __name__ == "__main__":
    main()
