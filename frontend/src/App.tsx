import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { callApi, formatResponse } from "./api";
import type { ApiCallResult, HttpMethod } from "./types";

type Page = "overview" | "notifications" | "catalog" | "sheets" | "api";
type Row = Record<string, unknown>;
type Verb = HttpMethod;

interface Operation {
  key: string;
  method: Verb;
  path: string;
  summary: string;
  hasBody: boolean;
  pathParams: string[];
}

const navigation: Array<{ id: Page; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "notifications", label: "Notifications", icon: "◉" },
  { id: "catalog", label: "Products & parts", icon: "▦" },
  { id: "sheets", label: "Workbook data", icon: "▤" },
  { id: "api", label: "API explorer", icon: "⌘" },
];

/** Show Soony data from the routes available in this FastAPI service.
 * @returns The procurement dashboard.
 */
export function App() {
  const [page, setPage] = useState<Page>("overview");
  const [health, setHealth] = useState<Row | null>(null);
  const [notifications, setNotifications] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [components, setComponents] = useState<Row[]>([]);
  const [bomLines, setBomLines] = useState<Row[]>([]);
  const [bomChanges, setBomChanges] = useState<Row[]>([]);
  const [sheetRows, setSheetRows] = useState<Row[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [selectedOperation, setSelectedOperation] = useState("");
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryText, setQueryText] = useState("");
  const [bodyText, setBodyText] = useState("{}\n");
  const [lastResponse, setLastResponse] = useState<ApiCallResult | null>(null);
  const [history, setHistory] = useState<ApiCallResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogTab, setCatalogTab] = useState<"products" | "components" | "bom" | "changes">("products");
  const [selectedSheet, setSelectedSheet] = useState<Row | null>(null);
  const [responseView, setResponseView] = useState<"pretty" | "raw">("pretty");
  const initialized = useRef(false);

  const request = useCallback(async (path: string, method: Verb = "GET", body?: unknown, show = true): Promise<ApiCallResult> => {
    const result = await callApi(path, method, body);
    setHistory((items) => [result, ...items].slice(0, 40));
    if (show) setLastResponse(result);
    if (!result.ok) {
      const payload = result.body;
      const detail = typeof payload === "object" && payload !== null && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : result.status === 0 ? "The backend could not be reached." : `${result.status} ${result.statusText}`;
      setError(detail);
    } else if (show) {
      setError(null);
    }
    return result;
  }, []);

  const refresh = useCallback(async () => {
    const routes = ["/health", "/notifications", "/products", "/components", "/bom-lines", "/bom-changes", "/sheet-rows"];
    const [healthResult, noticesResult, productsResult, componentsResult, bomResult, changesResult, sheetsResult] = await Promise.all(
      routes.map((path) => request(path, "GET", undefined, false)),
    );
    if (healthResult.ok) setHealth(asRow(healthResult.body));
    if (noticesResult.ok) setNotifications(asRows(noticesResult.body));
    if (productsResult.ok) setProducts(asRows(productsResult.body));
    if (componentsResult.ok) setComponents(asRows(componentsResult.body));
    if (bomResult.ok) setBomLines(asRows(bomResult.body));
    if (changesResult.ok) setBomChanges(asRows(changesResult.body));
    if (sheetsResult.ok) setSheetRows(asRows(sheetsResult.body));
    setLastResponse(healthResult);
    if ([healthResult, noticesResult, productsResult, componentsResult, bomResult, changesResult, sheetsResult].some((r) => !r.ok)) {
      setError("Some dashboard data could not load. Open API Explorer to inspect the failing response.");
    } else {
      setError(null);
    }
    const schema = await request("/openapi.json", "GET", undefined, false);
    if (schema.ok) {
      const parsed = parseOperations(schema.body);
      setOperations(parsed);
      setSelectedOperation((current) => parsed.some((operation) => operation.key === current) ? current : parsed[0]?.key ?? "");
    }
  }, [request]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void refresh();
  }, [refresh]);

  const activeOperation = operations.find((operation) => operation.key === selectedOperation) ?? operations[0];
  const visibleNotifications = useMemo(() => notifications.filter((item) => searchable(item).includes(query.toLowerCase())), [notifications, query]);
  const visibleProducts = useMemo(() => products.filter((item) => searchable(item).includes(query.toLowerCase())), [products, query]);
  const visibleComponents = useMemo(() => components.filter((item) => searchable(item).includes(query.toLowerCase())), [components, query]);
  const visibleSheets = useMemo(() => sheetRows.filter((item) => searchable(item).includes(query.toLowerCase())), [sheetRows, query]);

  async function runImport(path: string, label: string) {
    if (path !== "/import/sync" && !window.confirm(`${label} replaces the imported database rows. Continue?`)) return;
    setBusy(true);
    setNotice(null);
    const result = await request(path, "POST");
    if (result.ok) {
      setNotice(`${label} completed. Refreshing the dashboard.`);
      await refresh();
      setLastResponse(result);
    }
    setBusy(false);
  }

  async function sendOperation() {
    if (!activeOperation) return;
    let path = activeOperation.path;
    for (const name of activeOperation.pathParams) {
      const value = pathValues[name]?.trim();
      if (!value) { setError(`Enter a value for ${name}.`); return; }
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    if (queryText.trim()) path += `${path.includes("?") ? "&" : "?"}${queryText.trim().replace(/^\?/, "")}`;
    let body: unknown;
    if (["POST", "PATCH"].includes(activeOperation.method) && activeOperation.hasBody) {
      try { body = JSON.parse(bodyText) as unknown; }
      catch { setError("Request body must be valid JSON."); return; }
    }
    setBusy(true);
    await request(path, activeOperation.method, body);
    setBusy(false);
  }

  const title = navigation.find((item) => item.id === page)?.label ?? "Overview";
  const openNotifications = notifications.length;
  const counts = [products.length, components.length, sheetRows.length, notifications.length];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setPage("overview"); }}><span className="brand-icon">S</span><span>soony<span className="brand-dot">.</span><small>SUPPLY CONTROL</small></span></a>
      <div className="workspace-card"><span className="workspace-avatar">GH</span><span><strong>Grand Heist 6</strong><small>Hamburg · DC-HAM</small></span><span className="workspace-chevron">⌄</span></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="nav-list" aria-label="Main navigation">{navigation.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => setPage(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.id === "notifications" && openNotifications > 0 && <span className="nav-badge">{openNotifications}</span>}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-api"><span className={`online-dot ${health?.status === "ok" ? "" : "offline"}`} /><div><strong>{health?.status === "ok" ? "API connected" : health ? "API needs attention" : "Checking API…"}</strong><small>{health?.db ? `Database ${String(health.db)}` : "FastAPI connection status"}</small></div></div>
      <div className="sidebar-footer"><span className="user-avatar">L</span><div><strong>Launch team</strong><small>Soony workspace</small></div><span className="ellipsis">···</span></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="mobile-brand"><span className="brand-icon">S</span> Soony</div><div className="crumb">Procurement <span>/</span> <strong>{title}</strong></div><div className="topbar-actions"><div className={`api-health-chip ${health?.status === "ok" ? "" : "health-down"}`}><span />{health?.status === "ok" ? "API connected" : "API unavailable"}</div><button className="top-action" onClick={() => setPage("api")}><span>⌘</span> API calls <b>{history.length}</b></button><span className="top-divider" /><span className="top-avatar">S</span></div></header>
      <div className="page-content">
        {error && <div className="alert-banner alert-error" role="alert"><span className="alert-mark">!</span><div><strong>Request needs attention</strong><span>{error}</span></div><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="alert-banner alert-success" role="status"><span className="alert-mark">✓</span><div><strong>Import complete</strong><span>{notice}</span></div><button onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}

        {page === "overview" && <>
          <PageHeading eyebrow="SOONY PROCUREMENT DATA" title="A clearer view of the supply chain." subtitle="Explore the imported catalog, workbook records, notifications, and the exact responses from your backend." actions={<><button className="button button-light" onClick={() => void refresh()}>↻ Refresh</button><button className="button button-light" disabled={busy} onClick={() => void runImport("/import/sync", "Portal sync")}>⇅ Sync portal</button><button className="button button-primary" disabled={busy} onClick={() => void runImport("/import/master", "Master import")}>Import master data</button><button className="button button-primary" disabled={busy} onClick={() => void runImport("/import/sheets", "Workbook import")}>Import workbook</button></>} />
          <section className="deadline-strip"><div className="deadline-icon">◷</div><div><small>BACKEND STATUS</small><strong>{health?.status === "ok" ? "API and database are responding" : "Waiting for a healthy API connection"}</strong><span>Use Sync portal to download current files, then import the master and workbook data.</span></div><div className="deadline-rule"><b>DATA FLOW</b><span>Portal → local data folder → database tables → dashboard</span></div><span className={`verdict-pill ${health?.status === "ok" ? "verdict-go" : "verdict-no-go"}`}><i />{health?.status === "ok" ? "CONNECTED" : "CHECK API"}</span></section>
          <div className="kpi-grid">{[["PRODUCTS", counts[0], "Finished goods in the catalog", "▦", "green"], ["COMPONENTS", counts[1], "Parts in the catalog", "⌁", "blue"], ["WORKBOOK ROWS", counts[2], "Imported spreadsheet records", "▤", "amber"], ["NOTIFICATIONS", counts[3], "Recorded data differences", "!", "rose"]].map(([label, value, note, icon, tone]) => <button key={String(label)} className={`kpi-card kpi-${tone}`} onClick={() => setPage(label === "NOTIFICATIONS" ? "notifications" : label === "WORKBOOK ROWS" ? "sheets" : "catalog")}><span className="kpi-label">{label}</span><span className="kpi-icon">{icon}</span><strong>{Number(value).toLocaleString()}</strong><small>{note}</small></button>)}</div>
          <div className="section-head"><div><span className="section-icon">◉</span><div><h2>Get the data flowing</h2><p>Run these actions in order. Their actual API responses appear in API Explorer.</p></div></div><button className="link-button" onClick={() => setPage("api")}>Open API Explorer ↗</button></div>
          <div className="flow-grid">{[["01", "Sync portal", "Downloads new and changed portal files into DATA_DIR.", "POST /import/sync"], ["02", "Import master", "Loads products, components, BOM lines, and engineering changes.", "POST /import/master"], ["03", "Import workbook", "Loads spreadsheet rows into the workbook table.", "POST /import/sheets"]].map(([step, name, detail, route]) => <article className="panel flow-card" key={step}><span className="flow-step">{step}</span><div><strong>{name}</strong><p>{detail}</p><code>{route}</code></div></article>)}</div>
          <div className="section-head findings-head"><div><span className="section-icon section-warn">!</span><div><h2>Recent notifications</h2><p>Notifications returned by this backend are shown as recorded.</p></div></div><button className="link-button" onClick={() => setPage("notifications")}>All notifications →</button></div>
          <section className="finding-preview">{notifications.length ? notifications.slice(0, 5).map((item, index) => <DataRow key={String(item.id ?? index)} item={item} />) : <Empty title="No notifications returned" detail="The notifications endpoint is empty. Import data or open the API explorer to inspect the backend response." />}</section>
        </>}

        {page === "notifications" && <><PageHeading eyebrow="BACKEND RECORDS" title="Notifications" subtitle="Differences and alerts stored by the current backend." actions={<button className="button button-light" onClick={() => void request("/notifications")}>↻ Reload notifications</button>} /><div className="filter-bar"><Search value={query} onChange={setQuery} placeholder="Search notification data…" /><span className="result-count">{visibleNotifications.length} records</span></div><div className="findings-list">{visibleNotifications.length ? visibleNotifications.map((item, index) => <DataCard key={String(item.id ?? index)} item={item} />) : <Empty title="No matching notifications" detail="Try another search or inspect GET /notifications in API Explorer." />}</div></>}

        {page === "catalog" && <><PageHeading eyebrow="IMPORTED MASTER TABLES" title="Products & parts" subtitle="Browse the catalog tables imported from the Soony master files." actions={<><button className="button button-light" onClick={() => void refresh()}>↻ Reload tables</button><button className="button button-primary" disabled={busy} onClick={() => void runImport("/import/master", "Master import")}>Import master data</button></>} /><div className="master-toolbar"><div className="segmented">{(["products", "components", "bom", "changes"] as const).map((tab) => <button key={tab} className={catalogTab === tab ? "selected" : ""} onClick={() => setCatalogTab(tab)}>{tab === "bom" ? "BOM lines" : tab === "changes" ? "BOM changes" : capitalize(tab)}</button>)}</div><Search value={query} onChange={setQuery} placeholder="Search records…" /></div>{catalogTab === "products" && <DataTable rows={visibleProducts} empty="No products are imported yet." />}{catalogTab === "components" && <DataTable rows={visibleComponents} empty="No components are imported yet." />}{catalogTab === "bom" && <DataTable rows={bomLines.filter((item) => searchable(item).includes(query.toLowerCase()))} empty="No BOM lines are imported yet." />}{catalogTab === "changes" && <DataTable rows={bomChanges.filter((item) => searchable(item).includes(query.toLowerCase()))} empty="No BOM changes are imported yet." />}</>}

        {page === "sheets" && <><PageHeading eyebrow="IMPORTED SPREADSHEETS" title="Workbook data" subtitle="Rows imported from the Excel workbooks, with the source file, sheet, row number, and original cell values." actions={<><button className="button button-light" onClick={() => void request("/sheet-rows")}>↻ Reload rows</button><button className="button button-primary" disabled={busy} onClick={() => void runImport("/import/sheets", "Workbook import")}>Import workbook</button></>} /><div className="filter-bar"><Search value={query} onChange={setQuery} placeholder="Search sheet, source, kind, or cell values…" /><span className="result-count">{visibleSheets.length} rows</span></div><div className="sheet-layout"><DataTable rows={visibleSheets} empty="No workbook rows imported yet." onSelect={setSelectedSheet} /><aside className="panel sheet-detail"><div className="panel-top"><div><strong>Selected row</strong><span>GET /sheet-rows/{String(selectedSheet?.id ?? "{id}")}</span></div></div>{selectedSheet ? <pre className="json-block">{formatResponse(selectedSheet)}</pre> : <Empty title="Choose a row" detail="Select a workbook row to see its full response." />}</aside></div></>}

        {page === "api" && <><PageHeading eyebrow="LIVE FASTAPI SCHEMA" title="API Explorer" subtitle="Routes load from /openapi.json, so this page stays aligned with the backend that is actually running." actions={<span className="api-count-chip">{operations.length} operations detected</span>} /><div className="api-explorer-layout"><aside className="panel endpoint-list"><div className="endpoint-list-head"><strong>AVAILABLE OPERATIONS</strong><span>{operations.length}</span></div>{operations.map((operation) => <button className={`endpoint-item ${operation.key === activeOperation?.key ? "endpoint-active" : ""}`} key={operation.key} onClick={() => { setSelectedOperation(operation.key); setPathValues({}); }}><span className={`method method-${operation.method.toLowerCase()}`}>{operation.method}</span><span><strong>{operation.summary}</strong><small>{operation.path}</small></span></button>)}</aside><section className="api-workspace"><div className="panel request-panel"><div className="request-title"><div><span className="eyebrow">REQUEST BUILDER</span><h2>{activeOperation?.summary ?? "No API schema loaded"}</h2><p>Choose a route to make a request and inspect the backend response.</p></div>{activeOperation && <span className={`method method-${activeOperation.method.toLowerCase()}`}>{activeOperation.method}</span>}</div>{activeOperation && <><div className="request-line"><span className={`method method-${activeOperation.method.toLowerCase()}`}>{activeOperation.method}</span><code>{activeOperation.path}</code><button className="button button-primary" disabled={busy} onClick={() => void sendOperation()}>{busy ? "Sending…" : "Send request"} ↗</button></div>{activeOperation.pathParams.map((name) => <label className="field-label" key={name}>{name}<input value={pathValues[name] ?? ""} onChange={(event) => setPathValues((values) => ({ ...values, [name]: event.target.value }))} /></label>)}{!["GET", "DELETE"].includes(activeOperation.method) && <label className="field-label">Query string (optional)<input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="key=value&other=value" /></label>}{activeOperation.hasBody && <label className="field-label body-field">JSON request body<textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} spellCheck={false} /></label>}<div className="request-foot"><span>BASE URL</span><code>{window.location.origin}</code><span className="request-foot-note">FastAPI schema · no hardcoded route list</span></div></>}</div><ResponseView result={lastResponse} view={responseView} onView={setResponseView} onCopy={() => { if (lastResponse) void navigator.clipboard.writeText(formatResponse(lastResponse.body)); }} /></section></div><section className="panel call-history"><div className="panel-top"><div><strong>Recent API responses</strong><span>Click a request to inspect its exact response again.</span></div><span className="table-source">{history.length} this session</span></div>{history.length ? <div className="history-list">{history.map((item) => <button className="history-row" key={item.id} onClick={() => setLastResponse(item)}><span className={`method method-${item.method.toLowerCase()}`}>{item.method}</span><code>{item.path}</code><span className={`history-status ${item.ok ? "" : "history-fail"}`}>{item.status || "ERR"}</span><span>{item.durationMs} ms</span><time>{new Date(item.at).toLocaleTimeString()}</time></button>)}</div> : <Empty title="No API calls yet" detail="Send a request to begin inspecting live responses." />}</section></>}
      </div>
      <footer className="global-footer"><span>SOONY SUPPLY CONTROL <i>·</i> BACKEND CONNECTED EXPERIENCE</span><span>Values and records come from the live API.</span></footer>
    </main>
  </div>;
}

function parseOperations(value: unknown): Operation[] {
  const schema = asRow(value);
  const paths = asRow(schema.paths);
  const methods: Verb[] = ["GET", "POST", "PATCH", "DELETE"];
  const result: Operation[] = [];
  for (const [path, rawOperations] of Object.entries(paths)) {
    const pathOperations = asRow(rawOperations);
    for (const method of methods) {
      const details = asRow(pathOperations[method.toLowerCase()]);
      if (!Object.keys(details).length) continue;
      const requestBody = asRow(details.requestBody);
      result.push({
        key: `${method} ${path}`,
        method,
        path,
        summary: String(details.summary ?? details.operationId ?? `${method} ${path}`),
        hasBody: Boolean(Object.keys(requestBody).length),
        pathParams: [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
      });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function asRow(value: unknown): Row { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {}; }
function asRows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((row): row is Row => typeof row === "object" && row !== null && !Array.isArray(row)) : []; }
function searchable(value: Row): string { return JSON.stringify(value).toLowerCase(); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

function PageHeading({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-box"><span>⌕</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><kbd>⌕</kbd></label>;
}
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty-panel"><span>◌</span><strong>{title}</strong><p>{detail}</p></div>; }
function DataRow({ item }: { item: Row }) { return <article className="data-row"><span className="severity-mark severity-warning" /><span className="data-row-copy"><strong>{String(item.attr ?? item.title ?? `Notification ${item.id ?? ""}`)}</strong><small>{String(item.erp_val ?? "ERP value unavailable")} <b>↔</b> {String(item.customer_val ?? "Customer value unavailable")}</small></span><time>{item.seen_at ? new Date(String(item.seen_at)).toLocaleString() : ""}</time></article>; }
function DataCard({ item }: { item: Row }) { return <article className="finding-card"><div className="finding-stripe stripe-warning" /><div className="finding-main"><div className="finding-tags"><span className="severity-chip severity-warning">{String(item.attr ?? "notification")}</span><span className="kind-chip">#{String(item.id ?? "—")}</span></div><h3>{String(item.data && asRow(item.data).title ? asRow(item.data).title : item.attr ?? "Data difference")}</h3><p>{String(item.erp_val ?? "ERP value not provided")} <b>↔</b> {String(item.customer_val ?? "customer value not provided")}</p><pre className="json-block">{formatResponse(item)}</pre></div></article>; }
function DataTable({ rows, empty, onSelect }: { rows: Row[]; empty: string; onSelect?: (row: Row) => void }) {
  if (!rows.length) return <section className="panel"><Empty title={empty} detail="Use the import actions on Overview to load the local data." /></section>;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 7);
  return <section className="panel data-table-wrap"><div className="data-table-scroll"><table><thead><tr>{keys.map((key) => <th key={key}>{key.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.product_id ?? row.component_id ?? index)} onClick={() => onSelect?.(row)}>{keys.map((key) => <td key={key}>{cellText(row[key])}</td>)}</tr>)}</tbody></table></div></section>;
}
function cellText(value: unknown): string { if (value === null || value === undefined) return "—"; if (typeof value === "object") return JSON.stringify(value); return String(value); }
function ResponseView({ result, view, onView, onCopy }: { result: ApiCallResult | null; view: "pretty" | "raw"; onView: (value: "pretty" | "raw") => void; onCopy: () => void }) {
  const body = !result ? "// Choose an operation and send a request.\n// The exact backend response will appear here." : view === "pretty" ? formatResponse(result.body) : JSON.stringify(result.body);
  return <section className="panel response-panel"><div className="response-head"><div><span className="eyebrow">LIVE RESPONSE</span><h2>{result ? `${result.method} ${result.path}` : "Waiting for a request"}</h2></div>{result && <span className={`response-status ${result.ok ? "status-success" : "status-failed"}`}>{result.status || "ERR"} {result.statusText}</span>}</div><div className="response-meta"><span>TIME <b>{result ? `${result.durationMs} ms` : "—"}</b></span><span>RECEIVED <b>{result ? new Date(result.at).toLocaleTimeString() : "—"}</b></span><div className="response-tools"><div className="segmented compact"><button className={view === "pretty" ? "selected" : ""} onClick={() => onView("pretty")}>Pretty</button><button className={view === "raw" ? "selected" : ""} onClick={() => onView("raw")}>Raw</button></div><button className="copy-button" disabled={!result} onClick={onCopy}>Copy JSON</button></div></div><pre className="json-block response-json">{body}</pre><div className="response-foot"><span className={`response-indicator ${result?.ok ? "good" : result ? "bad" : ""}`} />{result ? result.ok ? "Response received from FastAPI." : "The request failed; the response body is shown above." : "Responses are displayed exactly as returned by FastAPI."}</div></section>;
}
