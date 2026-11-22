import { useEffect, useMemo, useState } from "react";
import { getDataset, listDatasets } from "./api";
import type { Dataset, DatasetInfo, Notification } from "./types";
import "./data.css";

type Cell = string | number | null | undefined;
const number = new Intl.NumberFormat("en-US");

/** A cell as a number, if it is one (German thousands like "42.900" included). */
function numeric(value: Cell): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !/^-?[\d.,]+$/.test(value.trim())) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The column(s) that identify a row in each dataset; only these are matched to issues. */
const KEY_COLUMNS: Record<string, string[]> = {
  stock: ["Material"], packed: ["Material"], shipments: ["shipment_id"], purchase_orders: ["po_number"],
  receipts: ["delivery_note", "po_number"], parts: ["component_id"], bom_changes: ["change_id", "child_id"],
  suppliers: ["supplier_id"], documents: ["path"],
};

/** Upper-case ids in open notification keys, without site codes (they appear everywhere). */
function issueIds(notifications: Notification[]): Set<string> {
  const ids = new Set<string>();
  for (const n of notifications) {
    if (n.data.status === "resolved") continue;
    for (const part of (n.data.key ?? "").split(":").slice(1)) if (part.length > 3 && !part.toUpperCase().startsWith("DC-")) ids.add(part.toUpperCase());
  }
  return ids;
}

/** Issue ids found in a row's key columns (file names count by their parts, not the supplier folder). */
function rowIssues(key: string, row: Record<string, Cell>, ids: Set<string>): string[] {
  const found = new Set<string>();
  for (const column of KEY_COLUMNS[key] ?? []) {
    const value = row[column];
    if (value == null) continue;
    for (const token of String(value).toUpperCase().split(/[\s|,;·()/_.]+/)) {
      if (ids.has(token) && !(key === "documents" && token.startsWith("SUP-"))) found.add(token);
    }
  }
  return [...found];
}

/** Data tab: the important tables of the Soony data set, with open issues marked. */
export function DataPage({ notifications }: { notifications: Notification[] }) {
  const [catalog, setCatalog] = useState<DatasetInfo[]>([]);
  const [key, setKey] = useState<string>(() => window.localStorage?.getItem("data-tab") ?? "stock");
  const [table, setTable] = useState<Dataset | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null);

  useEffect(() => { listDatasets().then(setCatalog).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load datasets.")); }, []);
  useEffect(() => {
    setTable(null);
    setSort(null);
    setError("");
    try { window.localStorage?.setItem("data-tab", key); } catch { /* storage may be blocked */ }
    getDataset(key).then(setTable).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the dataset."));
  }, [key]);

  const ids = useMemo(() => issueIds(notifications), [notifications]);
  const rows = useMemo(() => {
    if (!table) return [];
    const needle = query.trim().toLowerCase();
    let result = table.rows.map((row) => ({ row, issues: rowIssues(table.key, row, ids) }));
    if (onlyIssues) result = result.filter((r) => r.issues.length > 0);
    if (needle) result = result.filter((r) => Object.values(r.row).some((v) => v != null && String(v).toLowerCase().includes(needle)));
    if (sort) {
      result = [...result].sort((a, b) => {
        const x = a.row[sort.column], y = b.row[sort.column];
        const nx = numeric(x), ny = numeric(y);
        const order = nx != null && ny != null ? nx - ny : String(x ?? "").localeCompare(String(y ?? ""));
        return sort.desc ? -order : order;
      });
    }
    return result;
  }, [table, query, onlyIssues, sort, ids]);
  const flagged = useMemo(() => (table ? table.rows.filter((row) => rowIssues(table.key, row, ids).length > 0).length : 0), [table, ids]);

  return (
    <main className="main-content data-page" id="data">
      <header className="data-head">
        <h1>Data</h1>
        <span>The Soony data set as the agents read it · rows with an open issue are marked</span>
      </header>
      <div className="data-layout">
        <nav className="data-nav" aria-label="Datasets">
          {catalog.map((d) => (
            <button key={d.key} type="button" className={d.key === key ? "active" : ""} onClick={() => setKey(d.key)}>
              <strong>{d.title}</strong>
              <small>{d.description}</small>
            </button>
          ))}
        </nav>
        <section className="data-main" aria-live="polite">
          {error && <p className="message message-error" role="alert">{error}</p>}
          {!table && !error && <p className="data-muted">Loading…</p>}
          {table && (
            <>
              <div className="data-tools">
                <div>
                  <h2>{table.title}</h2>
                  <small>{rows.length === table.rows.length ? `${number.format(table.rows.length)} rows` : `${number.format(rows.length)} of ${number.format(table.rows.length)} rows`} · {table.source}</small>
                </div>
                <label className="data-toggle"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only rows with open issues ({flagged})</label>
                <input className="data-search" type="search" placeholder="Search this table" aria-label="Search this table" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {table.columns.map((column) => (
                        <th key={column} aria-sort={sort?.column === column ? (sort.desc ? "descending" : "ascending") : "none"}>
                          <button type="button" onClick={() => setSort((s) => s?.column === column ? { column, desc: !s.desc } : { column, desc: false })}>
                            {column.replace(/_/g, " ")}{sort?.column === column ? (sort.desc ? " ↓" : " ↑") : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 500).map(({ row, issues }, index) => (
                      <tr key={index} className={issues.length ? "data-flagged" : ""} title={issues.length ? `Open issue: ${issues.join(", ")}` : undefined}>
                        {table.columns.map((column) => {
                          const value = row[column];
                          const asNumber = numeric(value);
                          if (column === "path" && typeof value === "string") {
                            return <td key={column}><a href={`/dataset/file?path=${encodeURIComponent(value)}`} target="_blank" rel="noreferrer">{value}</a></td>;
                          }
                          return <td key={column} className={asNumber != null ? "num" : ""}>{asNumber != null && typeof value === "number" ? number.format(value) : value ?? ""}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 500 && <p className="data-muted data-more">Showing the first 500 rows; search or sort to narrow down.</p>}
                {rows.length === 0 && <p className="data-muted data-more">No rows match.</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
