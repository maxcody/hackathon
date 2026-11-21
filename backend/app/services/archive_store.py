"""Persist the latest imported portal snapshot and its change history."""

import json
import io
import zipfile
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.services.data_intake import (
    Document,
    build_archive_manifest,
    compare_manifests,
    compare_record_changes,
    compare_supplier_bank_details,
    detect_risks,
    parse_archive,
)


class ArchiveStore:
    """Keep Soony source files local and derive a comparable current snapshot."""

    def __init__(self, directory: Path) -> None:
        """Create a local snapshot store.

        Args:
            directory: Ignored local data directory for imported case files.
        """
        self.directory = directory
        self.archive_path = directory / "latest.zip"
        self.manifest_path = directory / "manifest.json"
        self.events_path = directory / "events.json"
        directory.mkdir(parents=True, exist_ok=True)

    def import_archive(self, content: bytes) -> dict[str, Any]:
        """Parse, compare, and persist one archive snapshot."""
        documents = parse_archive(content)
        current = build_archive_manifest(documents)
        previous = self._read_json(self.manifest_path, {})
        previous_documents = self.documents()
        changes = compare_manifests(previous, current)
        row_changes = compare_record_changes(previous_documents, documents)
        bank_changes = compare_supplier_bank_details(previous_documents, documents)
        imported_at = datetime.now(UTC).isoformat()
        events = self._read_json(self.events_path, [])
        all_changes = changes + row_changes
        for change in all_changes:
            events.insert(0, {**change, "detected_at": imported_at})
        for risk in bank_changes:
            events.insert(
                0,
                {
                    "kind": "risk",
                    "severity": risk["severity"],
                    "path": risk["evidence"],
                    "summary": risk["title"],
                    "detected_at": imported_at,
                },
            )
        self.archive_path.write_bytes(content)
        self.manifest_path.write_text(json.dumps(current, indent=2), encoding="utf-8")
        self.events_path.write_text(
            json.dumps(events[:100], indent=2), encoding="utf-8"
        )
        return {
            "file_count": len(documents),
            "changed_count": len(all_changes) + len(bank_changes),
            "changes": all_changes,
            "imported_at": imported_at,
        }

    def cached_files(self) -> dict[str, bytes]:
        """Return the current archive members keyed by normalized portal path."""
        if not self.archive_path.exists():
            return {}
        files = {}
        with zipfile.ZipFile(self.archive_path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                path = member.filename.replace("\\", "/")
                if path.startswith("soony-data/"):
                    path = path.removeprefix("soony-data/")
                files[path] = archive.read(member)
        return files

    def files_to_download(self, remote: dict[str, str]) -> list[str]:
        """Return only remote paths whose checksum is new or changed."""
        old_manifest = self._read_json(self.manifest_path, {})
        return [
            path
            for path, digest in remote.items()
            if old_manifest.get(path) != digest
        ]

    def commit_remote_files(
        self,
        remote: dict[str, str],
        downloaded: dict[str, bytes],
    ) -> dict[str, Any]:
        """Merge changed remote files with cached files and import the snapshot."""
        old_manifest = self._read_json(self.manifest_path, {})
        if remote == old_manifest and not downloaded and self.archive_path.exists():
            return {
                "file_count": len(remote),
                "changed_count": 0,
                "changes": [],
                "imported_at": datetime.fromtimestamp(
                    self.archive_path.stat().st_mtime, UTC
                ).isoformat(),
            }

        cached = self.cached_files()
        current = {}
        for path in remote:
            if path in downloaded:
                current[path] = downloaded[path]
            elif path in cached:
                current[path] = cached[path]
            else:
                raise ValueError(f"Missing cached or downloaded portal file: {path}")

        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, content in current.items():
                archive.writestr(f"soony-data/{path}", content)
        return self.import_archive(stream.getvalue())

    def documents(self) -> list[Document]:
        """Read and parse the most recently imported archive, if present."""
        if not self.archive_path.exists():
            return []
        return parse_archive(self.archive_path.read_bytes())

    def summary(self) -> dict[str, Any]:
        """Return import freshness, file inventory, risks, and recent changes."""
        documents = self.documents()
        events = self._read_json(self.events_path, [])
        bank_change_risks = [
            {
                "severity": event["severity"],
                "title": "Supplier bank details changed between snapshots",
                "detail": event["path"],
                "evidence": event["path"],
                "action": (
                    "Do not change payment instructions. Verify the request with a "
                    "known contact using an independent channel."
                ),
            }
            for event in events
            if event.get("kind") == "risk" and event.get("severity") == "critical"
        ]
        imported_at = None
        if self.archive_path.exists():
            imported_at = datetime.fromtimestamp(
                self.archive_path.stat().st_mtime, UTC
            ).isoformat()
        return {
            "imported": bool(documents),
            "file_count": len(documents),
            "row_count": sum(len(document.rows) for document in documents),
            "warning_count": sum(bool(document.warning) for document in documents),
            "imported_at": imported_at,
            "files": [
                {
                    "path": document.path,
                    "sha256": document.sha256,
                    "rows": len(document.rows),
                    "warning": document.warning,
                }
                for document in documents
            ],
            "risks": detect_risks(documents) + bank_change_risks,
            "events": events[:20],
        }

    @staticmethod
    def _read_json(path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return fallback
