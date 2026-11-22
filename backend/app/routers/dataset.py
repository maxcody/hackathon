"""The Data tab: read-only tables and documents from the Soony data folder."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app import dataset
from app.dataset import Dataset, DatasetInfo, FileInfo, Lookups

router = APIRouter(prefix="/dataset", tags=["dataset"])


@router.get("")
def list_datasets() -> list[DatasetInfo]:
    """The datasets the Data tab offers."""
    return dataset.catalog()


@router.get("/lookups")
async def get_lookups() -> Lookups:
    """Names of parts and suppliers, and documents behind delivery notes and POs."""
    return await run_in_threadpool(dataset.lookups)


@router.get("/files")
def list_files() -> list[FileInfo]:
    """Every file in the data folder, for the Files page."""
    return dataset.files()


@router.get("/file")
def get_file(path: str) -> FileResponse:
    """Open one file from the data folder (scans, PDFs, notices) in the browser."""
    try:
        return FileResponse(dataset.resolve(path), content_disposition_type="inline")
    except FileNotFoundError as exc:
        raise HTTPException(404, "File not found in the data folder.") from exc


@router.get("/{key}")
async def get_dataset(key: str) -> Dataset:
    """Rows and columns of one dataset."""
    try:
        return await run_in_threadpool(dataset.load, key)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown dataset {key!r}.") from exc
    except FileNotFoundError as exc:
        raise HTTPException(409, f"{exc} (run /import/sync?)") from exc
