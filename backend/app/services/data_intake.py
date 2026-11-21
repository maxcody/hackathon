"""Safely inspect procurement archives and detect evidence-backed changes."""

import csv
import email.policy
import hashlib
import io
import json
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from email.parser import BytesParser
from pathlib import Path
from typing import Any

MAX_ARCHIVE_BYTES = 60 * 1024 * 1024
MAX_EXPANDED_BYTES = 250 * 1024 * 1024
MAX_ARCHIVE_FILES = 2_000
BANK_CHANGE_TERMS = (
    "bank account change",
    "changed bank account",
    "bank account has changed",
    "supplier bank details have changed",
    "new bank details",
    "change of bank details",
    "new iban",
    "iban changed",
    "bankverbindung geändert",
    "änderung der bankverbindung",
    "zmiana rachunku bankowego",
    "zmieniono konto bankowe",
    "银行账户变更",
    "更改银行账户",
    "계좌 변경",
    "은행 계좌 변경",
)
COMPROMISE_TERMS = (
    "supplier account compromised",
    "supplier was hacked",
    "supplier email compromised",
    "hacked supplier",
    "cyberattack on supplier",
    "supplier cyber incident",
    "supplier account hacked",
    "공급업체 해킹",
    "공급업체 계정 침해",
    "공급업체 이메일 해킹",
    "供应商被黑客攻击",
    "供应商账户被盗",
    "供应商遭到网络攻击",
    "atak na dostawcę",
    "przejęto konto dostawcy",
)
DISRUPTION_TERMS = (
    "typhoon",
    "hurricane",
    "port closure",
    "port closed",
    "port congestion",
    "earthquake",
    "strike at port",
    "台风",
    "港口关闭",
    "港口拥堵",
    "港口罢工",
    "태풍",
    "항만 폐쇄",
    "항만 파업",
    "항만 혼잡",
    "tajfun",
    "zamknięcie portu",
    "strajk w porcie",
    "trzęsienie ziemi",
)
FIELD_ALIASES = {
    "ordered": (
        "orderedquantity", "orderquantity", "orderedqty", "orderqty",
        "quantityordered", "poquantity", "bestellmenge", "zamowionailosc",
        "주문수량", "订购数量", "訂購數量",
    ),
    "confirmed": (
        "confirmedquantity", "confirmationquantity", "confirmedqty",
        "acknowledgedquantity", "acknowledgedqty", "bestatigtebestellmenge",
        "potwierdzonailosc", "확인수량", "确认数量", "確認數量",
    ),
    "received": (
        "receivedquantity", "deliveredquantity", "goodsreceivedquantity",
        "receivedqty", "deliveredqty", "geliefertemenge", "otrzymanailosc",
        "입고수량", "收货数量", "已收货数量",
    ),
    "required": (
        "requiredquantity", "requiredqty", "materialrequirement", "demandquantity",
    ),
    "available": (
        "availablequantity", "availableqty", "freequantity", "unallocatedstock",
        "stockavailable",
    ),
    "status": ("status", "deliverystatus", "shipmentstatus", "confirmationstatus"),
    "eta": (
        "eta", "expectedarrival", "expecteddeliverydate", "promiseddeliverydate",
        "deliverydate", "arrivaldate", "liefertermin", "przewidywanadatadostawy",
        "예상도착일", "预计到达日期", "預計到達日期",
    ),
    "supplier": (
        "supplierid", "suppliernumber", "suppliername", "vendorid", "vendorname",
        "supplier", "vendor",
    ),
    "bank": (
        "iban",
        "bankaccount",
        "bankaccountnumber",
        "accountnumber",
        "bankdetails",
    ),
    "order_id": ("purchaseorder", "purchaseordernumber", "ponumber", "po", "orderid"),
    "line_id": ("lineitem", "linenumber", "lineid", "sku", "material", "item"),
}


@dataclass
class Document:
    """Parsed content and provenance for one archive member."""

    path: str
    sha256: str
    text: str
    rows: list[dict[str, Any]]
    warning: str | None = None


def parse_archive(content: bytes) -> list[Document]:
    """Read files from a zip archive without extracting paths.

    Args:
        content: Uploaded zip bytes.

    Returns:
        Parsed documents with source path and content checksum.

    Raises:
        ValueError: If the archive is invalid or exceeds safety limits.
    """
    if len(content) > MAX_ARCHIVE_BYTES:
        raise ValueError("Archive exceeds the 60 MB upload limit.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as error:
        raise ValueError(
            "Upload a valid .zip archive from the Soony portal."
        ) from error

    members = [item for item in archive.infolist() if not item.is_dir()]
    if len(members) > MAX_ARCHIVE_FILES:
        raise ValueError("Archive contains more than 2,000 files.")
    if sum(item.file_size for item in members) > MAX_EXPANDED_BYTES:
        raise ValueError("Archive expands beyond the 250 MB processing limit.")

    documents: list[Document] = []
    for member in members:
        path = member.filename.replace("\\", "/")
        if path.startswith("soony-data/"):
            path = path.removeprefix("soony-data/")
        try:
            raw = archive.read(member)
        except (OSError, RuntimeError, zipfile.BadZipFile):
            documents.append(
                Document(
                    path,
                    "unreadable",
                    "",
                    [],
                    "Archive member could not be read; verify the portal export.",
                )
            )
            continue
        digest = hashlib.sha256(raw).hexdigest()
        document = _parse_document(path, raw, digest)
        if document:
            documents.append(document)
    return documents


def _parse_document(path: str, raw: bytes, digest: str) -> Document | None:
    suffix = Path(path).suffix.casefold()
    try:
        if suffix == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            warning = (
                "No PDF text extracted; this may be a scanned document."
                if not text.strip()
                else None
            )
            return Document(path, digest, text, [], warning)
        if suffix == ".xlsx":
            from openpyxl import load_workbook

            workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            rows: list[dict[str, Any]] = []
            for sheet in workbook.worksheets:
                values = list(sheet.iter_rows(values_only=True))
                header_index = _find_spreadsheet_header(values)
                if header_index is None:
                    continue
                header_row = values[header_index]
                headers = [
                    str(cell or f"column_{index + 1}").strip()
                    for index, cell in enumerate(header_row)
                ]
                for cells in values[header_index + 1 :]:
                    rows.append(
                        {
                            header: value
                            for header, value in zip(headers, cells, strict=False)
                            if value is not None
                        }
                    )
            return Document(path, digest, "", rows)
        if suffix == ".docx":
            with zipfile.ZipFile(io.BytesIO(raw)) as package:
                root = ET.fromstring(package.read("word/document.xml"))
            namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            paragraphs = [
                "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace))
                for paragraph in root.findall(".//w:p", namespace)
            ]
            return Document(path, digest, "\n".join(paragraphs), [])
        image_suffixes = {
            ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"
        }
        if suffix in image_suffixes:
            return Document(
                path,
                digest,
                "",
                [],
                "Image scan is indexed but needs OCR or human review.",
            )

        text = _decode_text(raw)
        if suffix == ".eml":
            message = BytesParser(policy=email.policy.default).parsebytes(raw)
            bodies = []
            for part in message.walk():
                if part.get_content_type() not in {"text/plain", "text/html"}:
                    continue
                if part.get_content_disposition() == "attachment":
                    continue
                body = part.get_content()
                if isinstance(body, str):
                    bodies.append(body)
            return Document(path, digest, "\n".join(bodies), [])
        if suffix in {".csv", ".tsv"}:
            dialect = _csv_dialect(text, suffix)
            rows = [
                dict(row)
                for row in csv.DictReader(io.StringIO(text), dialect=dialect)
            ]
            return Document(path, digest, text, rows)
        if suffix == ".json":
            return Document(path, digest, text, _json_records(json.loads(text)))
        if suffix in {".txt", ".md", ".eml", ".xml", ".html"}:
            return Document(path, digest, text, [])
        return Document(
            path,
            digest,
            "",
            [],
            "Unsupported file type "
            f"{suffix or '(no extension)'}; indexed for change tracking only.",
        )
    except Exception as error:
        return Document(path, digest, "", [], f"Could not parse: {error}")


def _find_spreadsheet_header(rows: list[tuple[Any, ...]]) -> int | None:
    """Find the first tabular header row after spreadsheet title rows."""
    header_terms = {
        "date", "dayonedemand", "demand", "packed", "stilltopack", "product",
        "edition", "name", "part", "component", "supplier", "quantity", "qty",
        "eta", "status", "materialid", "parentid", "childid", "po", "ponumber",
        "site", "stock", "required", "confirmed", "received", "line", "revision",
        "drawingrev", "field", "action", "reference", "shipmentid", "orderid",
    }
    for index, row in enumerate(rows):
        labels = [
            _normalize_key(value)
            for value in row
            if value is not None and str(value).strip()
        ]
        if len(labels) >= 2 and sum(label in header_terms for label in labels) >= 2:
            return index
    return None


def _json_records(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        records = [item for item in value if isinstance(item, dict)]
        if records:
            return records
        return [row for item in value for row in _json_records(item)]
    if isinstance(value, dict):
        if all(not isinstance(child, (dict, list)) for child in value.values()):
            return [value]
        return [row for child in value.values() for row in _json_records(child)]
    return []


def _decode_text(raw: bytes) -> str:
    """Decode common supplier encodings before falling back to replacement."""
    encodings = ["utf-8-sig"]
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings.insert(0, "utf-16")
    for encoding in encodings:
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    try:
        from charset_normalizer import from_bytes

        match = from_bytes(raw).best()
        if match:
            return str(match)
    except ImportError:
        pass
    encodings = ["cp949", "gb18030", "cp1250", "cp1252"]
    for encoding in encodings:
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")


def _csv_dialect(text: str, suffix: str) -> csv.Dialect:
    """Detect common comma, semicolon, pipe, and tab-separated exports."""
    if suffix == ".tsv":
        return csv.excel_tab
    try:
        return csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def build_archive_manifest(documents: list[Document]) -> dict[str, str]:
    """Return the latest checksum by normalized archive path."""
    return {document.path: document.sha256 for document in documents}


def compare_manifests(
    previous: dict[str, str], current: dict[str, str]
) -> list[dict[str, str]]:
    """Identify new, changed, and removed source files between snapshots."""
    changes: list[dict[str, str]] = []
    for path, digest in current.items():
        if path not in previous:
            changes.append(
                {"kind": "new", "path": path, "summary": "New source file detected."}
            )
        elif previous[path] != digest:
            changes.append(
                {
                    "kind": "changed",
                    "path": path,
                    "summary": "Source file content changed since the prior import.",
                }
            )
    for path in previous.keys() - current.keys():
        changes.append(
            {
                "kind": "removed",
                "path": path,
                "summary": "Source file is absent from the latest snapshot.",
            }
        )
    return changes


def compare_supplier_bank_details(
    previous_documents: list[Document], current_documents: list[Document]
) -> list[dict[str, str]]:
    """Detect changed bank values for the same supplier across snapshots."""
    previous = _bank_values(previous_documents)
    current = _bank_values(current_documents)
    changes = []
    for supplier, current_value in current.items():
        previous_value = previous.get(supplier)
        if previous_value and previous_value[0] != current_value[0]:
            changes.append(
                _risk(
                    "critical",
                    "Supplier bank details changed between snapshots",
                    current_value[1],
                    "Do not change payment instructions. Verify the request with a "
                    "known "
                    "contact using an independent channel.",
                )
            )
    return changes


def compare_record_changes(
    previous_documents: list[Document], current_documents: list[Document]
) -> list[dict[str, str]]:
    """Find row-level changes for records with stable purchase-order keys."""
    previous = _keyed_rows(previous_documents)
    current = _keyed_rows(current_documents)
    events = []
    for key, (path, row) in current.items():
        old = previous.get(key)
        if old is None:
            continue
        changed_fields = sorted(
            field
            for field in set(row) | set(old[1])
            if str(row.get(field, "")) != str(old[1].get(field, ""))
        )
        if changed_fields:
            events.append(
                {
                    "kind": "changed",
                    "path": f"{path} · {key}",
                    "summary": "Record updated; changed fields: "
                    + ", ".join(changed_fields[:8]),
                }
            )
    return events


def detect_risks(documents: list[Document]) -> list[dict[str, Any]]:
    """Apply transparent rules to imported records and document text."""
    risks: list[dict[str, Any]] = []
    for document in documents:
        content = f"{document.path}\n{document.text}"
        folded = content.casefold()
        if _contains_any(folded, BANK_CHANGE_TERMS):
            risks.append(
                _risk(
                    "critical",
                    "Supplier bank details changed — verify out of band",
                    document.path,
                    "Bank changes can redirect payments. Freeze payment-detail updates "
                    "and verify with a known supplier contact through another channel.",
                )
            )
        if _contains_any(folded, COMPROMISE_TERMS):
            risks.append(
                _risk(
                    "critical",
                    "Supplier cyber compromise reported",
                    document.path,
                    "Treat supplier messages and payment instructions as untrusted "
                    "until "
                    "the supplier is verified through a known channel.",
                )
            )
        if _contains_any(folded, DISRUPTION_TERMS):
            risks.append(
                _risk(
                    "high",
                    "Weather or port disruption mentioned",
                    document.path,
                    "Check whether the affected supplier and route appear in order and "
                    "shipment records before changing the plan.",
                )
            )

        for row_number, row in enumerate(document.rows, start=2):
            risks.extend(_record_risks(document.path, row_number, row))

    return _deduplicate(risks)


def _record_risks(
    path: str, row_number: int, row: dict[str, Any]
) -> list[dict[str, Any]]:
    normalized = {_normalize_key(key): value for key, value in row.items()}
    label = _first(
        normalized,
        (
            *FIELD_ALIASES["supplier"],
            "po",
            "ponumber",
            *FIELD_ALIASES["order_id"],
            *FIELD_ALIASES["line_id"],
        ),
    )
    source = f"{path} · row {row_number}" + (f" · {label}" if label else "")
    output: list[dict[str, Any]] = []

    ordered = _number(_first(normalized, FIELD_ALIASES["ordered"]))
    confirmed = _number(_first(normalized, FIELD_ALIASES["confirmed"]))
    received = _number(_first(normalized, FIELD_ALIASES["received"]))
    promised = confirmed if confirmed is not None else ordered
    delivered = received if received is not None else None

    required = _number(_first(normalized, FIELD_ALIASES["required"]))
    available = _number(_first(normalized, FIELD_ALIASES["available"]))
    if required is not None and available is not None and available < required:
        output.append(
            _risk(
                "high",
                "Available stock is below the recorded requirement",
                source,
                f"Requirement is {required:g}; available quantity is {available:g}. "
                "Confirm reservations and replenishment timing.",
            )
        )

    if ordered is not None and confirmed is not None and confirmed < ordered:
        output.append(
            _risk(
                "high",
                "Supplier confirmed less than the ordered quantity",
                source,
                f"PO quantity is {ordered:g}; supplier confirmation is {confirmed:g}. "
                "Ask the buyer to reconcile the shortfall.",
            )
        )
    if promised is not None and delivered is not None and delivered < promised:
        output.append(
            _risk(
                "high",
                "Goods receipt is below the confirmed quantity",
                source,
                f"Confirmed quantity is {promised:g}; received quantity is "
                f"{delivered:g}. "
                "Check open deliveries and whether the shortfall blocks assembly.",
            )
        )

    status = str(_first(normalized, FIELD_ALIASES["status"]) or "").casefold()
    status_terms = (
        "delay", "late", "blocked", "cancelled", "canceled", "short ship",
        "disruption", "stuck", "verzög", "opóźn", "지연", "지연됨", "延迟",
    )
    if _contains_any(status, status_terms):
        output.append(
            _risk(
                "high",
                "Order or shipment status signals a disruption",
                source,
                f"Recorded status: {status}. Confirm the latest ETA and quantify "
                "the impact on required components.",
            )
        )

    eta_value = _first(normalized, FIELD_ALIASES["eta"])
    eta = _date(eta_value)
    release_day = date(2026, 11, 22)
    if eta and eta > release_day:
        output.append(
            _risk(
                "medium",
                "Recorded delivery date is after the launch day",
                source,
                f"Recorded date: {eta.isoformat()}. Confirm whether this replenishment is needed for day-one demand and whether current stock covers it.",
            )
        )
    if eta and eta < date.today():
        output.append(
            _risk(
                "medium",
                "Recorded delivery date is in the past",
                source,
                f"Recorded date: {eta.isoformat()}. Confirm receipt or update "
                "the ETA with the supplier.",
            )
        )
    return output


def _risk(severity: str, title: str, source: str, action: str) -> dict[str, str]:
    return {
        "severity": severity,
        "title": title,
        "detail": source,
        "evidence": source,
        "action": action,
    }


def _contains_any(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase.casefold() in text for phrase in phrases)


def _normalize_key(key: Any) -> str:
    value = unicodedata.normalize("NFKD", str(key).casefold())
    value = value.translate(str.maketrans({"ł": "l", "ø": "o", "ß": "ss"}))
    return "".join(
        character
        for character in value
        if character.isalnum() and not unicodedata.combining(character)
    )


def _first(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
    return next(
        (row[key] for key in keys if key in row and row[key] not in (None, "")),
        None,
    )


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return None


def _date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        return None
    string = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(string[:10], pattern).date()
        except ValueError:
            pass
    return None


def _deduplicate(risks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str]] = set()
    results = []
    for risk in risks:
        key = (risk["title"], risk["evidence"], risk["severity"])
        if key not in seen:
            seen.add(key)
            results.append(risk)
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(results, key=lambda item: order.get(item["severity"], 4))[:50]


def _bank_values(documents: list[Document]) -> dict[str, tuple[str, str]]:
    values: dict[str, tuple[str, str]] = {}
    for document in documents:
        for row_number, row in enumerate(document.rows, start=2):
            normalized = {_normalize_key(key): value for key, value in row.items()}
            supplier = _first(normalized, FIELD_ALIASES["supplier"])
            bank = _first(normalized, FIELD_ALIASES["bank"])
            if supplier and bank:
                source = f"{document.path} · row {row_number} · {supplier}"
                values[str(supplier).casefold()] = (str(bank).strip(), source)
    return values


def _keyed_rows(documents: list[Document]) -> dict[str, tuple[str, dict[str, Any]]]:
    keyed: dict[str, tuple[str, dict[str, Any]]] = {}
    for document in documents:
        for row in document.rows:
            normalized = {_normalize_key(key): value for key, value in row.items()}
            order_id = _first(normalized, FIELD_ALIASES["order_id"])
            line_id = _first(normalized, FIELD_ALIASES["line_id"])
            if order_id is not None:
                key = f"PO {order_id}"
                if line_id is not None:
                    key += f" / {line_id}"
                keyed[key] = (document.path, normalized)
    return keyed
