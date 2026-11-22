import { useEffect, useMemo, useState } from "react";
import { getDataset, getLookups, listDatasets } from "./api";
import type { Dataset, DatasetColumn, DatasetInfo, Lookups, Notification } from "./types";
import "./data.css";

type Cell = string | number | null | undefined;
type Row = Record<string, Cell>;
/** A table view: which dataset, optionally filtered to rows whose column holds one id. */
interface View { key: string; filter?: { column: string; value: string; label: string } }

const number = new Intl.NumberFormat("en-US");
const CURRENCY: Record<string, string> = { EUR: "€", USD: "$", CNY: "¥", INR: "₹", KRW: "₩", PLN: "zł " };
/** Which dataset/column a linkable kind opens (mirrors app/dataset.py LINKS). */
const LINKS: Record<string, { dataset: string; column: string }> = {
  part: { dataset: "parts", column: "component_id" },
  supplier: { dataset: "suppliers", column: "supplier_id" },
  po: { dataset: "purchase_orders", column: "po_number" },
  shipment: { dataset: "shipments", column: "shipment_id" },
};
const STATUS_TONE: [RegExp, string][] = [
  [/delay|held|hold|reject|cancel|block|expired|awaiting|conditional/i, "bad"],
  [/arrived|deliver|received|closed|complete|qualified|active|released|confirmed/i, "ok"],
];

/** The ids in a cell; multi-value cells separate them with "|". */
function ids(value: Cell, multi: boolean): string[] {
  if (value == null || value === "") return [];
  const text = String(value);
  return multi ? text.split("|").map((v) => v.trim()).filter(Boolean) : [text];
}

/** "2026-11-21" or "2026-11-21 20:50" → "21 Nov 2026" / "21 Nov 2026, 20:50". */
function formatDate(value: Cell): string {
  if (value == null || value === "") return "";
  const text = String(value);
  const date = new Date(text.length === 10 ? `${text}T12:00:00` : text.replace(" ", "T"));
  if (Number.isNaN(date.valueOf())) return text;
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return /\d{2}:\d{2}/.test(text) ? `${day}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : day;
}

/** "2.10 EUR" → "€2.10". */
function formatMoney(value: Cell): string {
  const [amount, currency] = String(value ?? "").split(" ");
  if (!amount) return "";
  const n = Number(amount);
  const shown = Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : amount;
  return currency && CURRENCY[currency] ? `${CURRENCY[currency]}${shown}` : `${shown} ${currency ?? ""}`.trim();
}

/** Value used for sorting a column. */
function sortValue(value: Cell, kind: string): number | string {
  if (typeof value === "number") return value;
  if (kind === "money") return Number(String(value ?? "").split(" ")[0]) || 0;
  if (value == null || value === "") return kind === "balance" || kind === "qty" ? Number.POSITIVE_INFINITY : "";
  return String(value ?? "").toLowerCase();
}

/** Upper-case ids in open notification keys, without site codes (they appear everywhere). */
function issueIds(notifications: Notification[]): Set<string> {
  const found = new Set<string>();
  for (const n of notifications) {
    if (n.data.status === "resolved") continue;
    for (const part of (n.data.key ?? "").split(":").slice(1)) if (part.length > 3 && !part.toUpperCase().startsWith("DC-")) found.add(part.toUpperCase());
  }
  return found;
}

/** Open-issue ids in a row: only the row's own identifying columns count. */
function rowIssues(table: Dataset, row: Row, open: Set<string>): string[] {
  const identifying = new Set(["part", "po", "shipment", "delivery_note", "file"]);
  const first = table.columns[0];
  const found = new Set<string>();
  for (const column of table.columns) {
    if (column !== first && !identifying.has(column.kind)) continue;
    if (table.key === "parts" || table.key === "suppliers") { if (column !== first) continue; }
    for (const id of ids(row[column.key], column.multi)) {
      for (const token of id.toUpperCase().split(/[\s/_.]+/)) if (open.has(token) && !(column.kind === "file" && token.startsWith("SUP-"))) found.add(token);
    }
  }
  return [...found];
}

/** Data tab: the Soony data set as linked, formatted tables, with open issues marked. */
export function DataPage({ notifications }: { notifications: Notification[] }) {
  const [catalog, setCatalog] = useState<DatasetInfo[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ parts: {}, suppliers: {}, documents: {}, open_orders: [] });
  const openOrders = useMemo(() => new Set(lookups.open_orders), [lookups]);
  const [view, setView] = useState<View>(() => {
    try { const saved = window.localStorage.getItem("data-tab"); return { key: saved && !["stock", "packed", "bom_changes", "documents"].includes(saved) ? saved : "parts" }; } catch { return { key: "parts" }; }
  });
  const [history, setHistory] = useState<View[]>([]);
  const [table, setTable] = useState<Dataset | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null);

  useEffect(() => {
    listDatasets().then(setCatalog).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load datasets."));
    getLookups().then(setLookups).catch(() => undefined);
  }, []);
  useEffect(() => {
    setTable(null);
    setSort(null);
    setError("");
    try { window.localStorage.setItem("data-tab", view.key); } catch { /* storage may be blocked */ }
    getDataset(view.key).then(setTable).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the dataset."));
  }, [view.key]);

  /** Open another table (optionally filtered), remembering where we came from. */
  function open(next: View) {
    setHistory((h) => [...h, view]);
    setQuery("");
    setOnlyIssues(false);
    setView(next);
  }
  function back() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setView(previous);
  }

  const open_ = useMemo(() => issueIds(notifications), [notifications]);
  const rows = useMemo(() => {
    if (!table) return [];
    const needle = query.trim().toLowerCase();
    let result = table.rows.map((row) => ({ row, issues: rowIssues(table, row, open_) }));
    const filter = view.filter;
    if (filter) result = result.filter(({ row }) => ids(row[filter.column], true).includes(filter.value) || String(row[filter.column] ?? "") === filter.value);
    if (onlyIssues) result = result.filter((r) => r.issues.length > 0);
    if (needle) {
      result = result.filter(({ row }) => table.columns.some((c) => {
        const value = row[c.key];
        if (value == null) return false;
        const named = ids(value, c.multi).map((id) => lookups.parts[id] ?? lookups.suppliers[id] ?? "").join(" ");
        return `${value} ${named}`.toLowerCase().includes(needle);
      }));
    }
    if (sort) {
      const kind = table.columns.find((c) => c.key === sort.column)?.kind ?? "text";
      result = [...result].sort((a, b) => {
        const x = sortValue(a.row[sort.column], kind), y = sortValue(b.row[sort.column], kind);
        const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.desc ? -order : order;
      });
    }
    return result;
  }, [table, view.filter, query, onlyIssues, sort, open_, lookups]);
  const flagged = useMemo(() => (table ? table.rows.filter((row) => rowIssues(table, row, open_).length > 0).length : 0), [table, open_]);

  /** One id as a link to its own table, with its name and any documents behind it. */
  function idLink(id: string, column: DatasetColumn) {
    // Orders only link when they are listed under "Open orders"
    const target = column.kind === "po" && !openOrders.has(id) ? undefined : LINKS[column.kind];
    const name = column.kind === "part" ? lookups.parts[id] : column.kind === "supplier" ? lookups.suppliers[id] : undefined;
    const docs = column.kind === "po" || column.kind === "delivery_note" ? lookups.documents[id] ?? [] : [];
    const label = column.kind === "supplier" && name ? name : id;
    const isSelf = target && target.dataset === view.key && target.column === column.key;
    return (
      <span key={id} className="data-id">
        {target && !isSelf
          ? <button type="button" className="data-link" onClick={() => open({ key: target.dataset, filter: { column: target.column, value: id, label: name ? `${id} · ${name}` : id } })}>{label}</button>
          : <span className={column.kind === "supplier" ? "data-strong" : "data-mono"}>{label}</span>}
        {column.kind === "part" && name && <small>{name}</small>}
        {column.kind === "supplier" && name && <small>{id}</small>}
        {docs.map((path) => <a key={path} className="data-doc" href={`/dataset/file?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer" title={path}>📄</a>)}
      </span>
    );
  }

  /** Render one cell according to its column kind. */
  function cell(row: Row, column: DatasetColumn) {
    const value = row[column.key];
    if (value == null || value === "") return <td key={column.key} className="data-empty">–</td>;
    switch (column.kind) {
      case "balance": {
        const n = Number(value);
        return <td key={column.key} className={`num data-balance ${n < 0 ? "data-short" : "data-ok"}`}>{n > 0 ? "+" : n < 0 ? "−" : ""}{number.format(Math.abs(n))}</td>;
      }
      case "qty": return <td key={column.key} className="num">{typeof value === "number" ? number.format(value) : value}</td>;
      case "money": return <td key={column.key} className="num">{formatMoney(value)}</td>;
      case "date": return <td key={column.key} className="nowrap">{formatDate(value)}</td>;
      case "flag": return <td key={column.key}>{value === "Y" ? <span className="data-chip data-chip-flag">Yes</span> : value === "N" ? <span className="data-muted">No</span> : String(value)}</td>;
      case "status": {
        const text = String(value).replace(/_/g, " ");
        const tone = STATUS_TONE.find(([pattern]) => pattern.test(text))?.[1] ?? "plain";
        return <td key={column.key}><span className={`data-chip data-chip-${tone}`}>{text}</span></td>;
      }
      case "file": {
        const path = String(value);
        return <td key={column.key}><a className="data-file" href={`/dataset/file?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer"><strong>{path.split("/").pop()}</strong><small>{path.split("/").slice(0, -1).join(" / ")}</small></a></td>;
      }
      case "part": case "supplier": case "po": case "shipment": case "delivery_note":
        return <td key={column.key}><div className="data-ids">{ids(value, column.multi).map((id) => idLink(id, column))}</div></td>;
      default: return <td key={column.key}>{String(value)}</td>;
    }
  }

  return (
    <main className="main-content data-page" id="data">
      <header className="data-head">
        <h1>Data</h1>
        <span>What you need to run and watch the supply chain · click an id to jump to its table · rows with an open issue are marked</span>
      </header>
      <div className="data-layout">
        <nav className="data-nav" aria-label="Datasets">
          {catalog.map((d) => (
            <button key={d.key} type="button" className={d.key === view.key ? "active" : ""} onClick={() => { setHistory([]); setQuery(""); setView({ key: d.key }); }}>
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
                <div className="data-title">
                  {history.length > 0 && <button type="button" className="data-back" onClick={back}>← Back</button>}
                  <div>
                    <h2>{table.title}</h2>
                    <small>{rows.length === table.rows.length ? `${number.format(table.rows.length)} rows` : `${number.format(rows.length)} of ${number.format(table.rows.length)} rows`} · {table.source}</small>
                  </div>
                </div>
                {view.filter && <span className="data-filter">{table.columns.find((c) => c.key === view.filter?.column)?.label ?? view.filter.column}: <strong>{view.filter.label}</strong><button type="button" aria-label="Remove filter" onClick={() => setView({ key: view.key })}>×</button></span>}
                <label className="data-toggle"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Open issues only ({flagged})</label>
                <input className="data-search" type="search" placeholder="Search this table" aria-label="Search this table" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {table.columns.map((column) => (
                        <th key={column.key} className={["qty", "money", "balance"].includes(column.kind) ? "num" : ""} aria-sort={sort?.column === column.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                          <button type="button" onClick={() => setSort((s) => s?.column === column.key ? { column: column.key, desc: !s.desc } : { column: column.key, desc: false })}>
                            {column.label}{sort?.column === column.key ? (sort.desc ? " ↓" : " ↑") : ""}
                          </button>
                        </th>
                      ))}
                      {table.related.length > 0 && <th><span className="data-th">Related</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 500).map(({ row, issues }, index) => (
                      <tr key={index} className={issues.length ? "data-flagged" : ""} title={issues.length ? `Open issue: ${issues.join(", ")}` : undefined}>
                        {table.columns.map((column) => cell(row, column))}
                        {table.related.length > 0 && (
                          <td className="data-related">
                            {table.related.map((r) => {
                              const id = String(row[r.value_from] ?? "");
                              const name = lookups.parts[id] ?? lookups.suppliers[id];
                              return id ? <button key={r.label} type="button" className="data-link" onClick={() => open({ key: r.dataset, filter: { column: r.column, value: id, label: name ? `${id} · ${name}` : id } })}>{r.label}</button> : null;
                            })}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 500 && <p className="data-muted data-more">Showing the first 500 rows; search, filter or sort to narrow down.</p>}
                {rows.length === 0 && <p className="data-muted data-more">No rows match.</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
