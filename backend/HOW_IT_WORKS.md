# How the backend works

A CRUD API over Postgres for Soony's launch data and the notifications the frontend shows, plus loaders that fill the tables from the portal files.

## Tables and endpoints

Every table has the same five endpoints, built by one generic router (`app/crud.py`):
`GET /x` (list), `GET /x/{id}`, `POST /x` (201), `PATCH /x/{id}` (send only the fields to change), `DELETE /x/{id}` (204).
Unknown id is 404. A duplicate key, a missing reference, or deleting a row that is still referenced is 409. A bad body is 422.

| Prefix | Table | Key | Holds |
|---|---|---|---|
| `/products` | `products` | `product_id` | Finished goods (editions), returned with their BOM lines |
| `/components` | `components` | `component_id` | Parts, with current drawing revision |
| `/bom-lines` | `bom_lines` | `id` | Which parts go into which product, and how many |
| `/bom-changes` | `bom_changes` | `change_id` | Engineering changes, including `use_up_old_rev` |
| `/sheet-rows` | `sheet_rows` | `id` | Excel rows (`kind`: editions, parts, inbound, shifts, shipments, price_list, stock, packed, notes) with a `data` JSON keyed by the sheet's own column labels |
| `/notifications` | `notifications` | `id` | What the frontend shows as alerts |
| `/health` | - | - | App and database check |

Product BOM lines are edited through `/bom-lines`, not through `/products`.

## Importing from the portal files

| Endpoint | Does |
|---|---|
| `POST /import/sync` | Download new or changed files from the Soony portal into `DATA_DIR` (needs `PORTAL_TOKEN`). |
| `POST /import/master` | Reload products, components, BOM lines and BOM changes from the CSVs. |
| `POST /import/sheets` | Reload `sheet_rows` from every xlsx in `DATA_DIR`. |

Files are recognised by their header columns or labels, not by file name, sheet name or folder, so renamed or re-dated files still import (`app/master_import.py`, `app/sheet_import.py`). German thousands in counts (`640.000`) are read as 640,000. Stray or footnote rows are skipped and listed in the response.

**An import replaces all rows of the tables it fills**, so edits made through the CRUD endpoints to those tables are overwritten by the next import. Notifications are never touched by an import.

## Notifications

One row per happening where the ERP and the customer side disagree.

| Field | Meaning |
|---|---|
| `id` | Notification id |
| `attr` | What differs, for example `quantity` |
| `erp_val` | The ERP's value, as text |
| `customer_val` | The customer side's value, as text |
| `data` | JSON for everything else, for example `kind`, `status`, `title`, `subject`, `refs` |
| `seen_at` | When it was last detected. Defaults to creation; send it again when the problem is re-detected |

There is no fixed schema inside `data`, and nothing deduplicates notifications: a check that runs repeatedly must find its earlier row (for example by a key it stores in `data`) and `PATCH` it. Display text is built by the frontend.

## Run it

From `backend/` with the venv active:

```
docker compose up -d db      # from the repo root
make migrate                 # create the tables
make run                     # API at http://localhost:8000/docs
make test                    # needs the db container
```

Tests create and drop a throwaway `hackathon_test` database and skip if Postgres is not running. Config lives in `backend/.env` (`DATABASE_URL`, `DATA_DIR`, `PORTAL_URL`, `PORTAL_TOKEN`; see `.env.example`).
