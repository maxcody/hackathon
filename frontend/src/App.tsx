import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importMaster, importSheets, listNotifications, syncPortal, updateNotificationData } from "./api";
import type { Notification, Severity } from "./types";
import { AgentsPage } from "./AgentsPage";

const severityOrder: Severity[] = ["critical", "warning", "info"];
/** CSS severity classes from the original design, keyed by notification severity. */
const severityClass: Record<string, string> = { critical: "critical", warning: "high", info: "low" };
const REFRESH_MS = 30 * 1000;

/** Format a timestamp for the viewer's local timezone. */
function localTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

const LAUNCH = new Date("2026-11-22T20:00:00+01:00");

/** Time left until launch, e.g. "14 h 20 min left". */
function timeToLaunch(): string {
  const minutes = Math.round((LAUNCH.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "launched";
  const hours = Math.floor(minutes / 60);
  return hours >= 48 ? `${Math.floor(hours / 24)} days left` : `${hours} h ${minutes % 60} min left`;
}

/** Normalize a notification's free-text severity to a known level. */
function severityOf(notification: Notification): Severity {
  const value = String(notification.data.severity ?? "").toLowerCase();
  return (severityOrder as string[]).includes(value) ? (value as Severity) : "info";
}

/** Whether a notification still needs a person. */
function isOpen(notification: Notification): boolean {
  return (notification.data.status ?? "open") !== "resolved";
}

/** Render a compact visual symbol with an accessible label. */
function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    grid: "▦", file: "▤", clock: "◷", refresh: "↻", check: "✓",
    search: "⌕", spark: "✳", alert: "!",
  };
  return <span aria-hidden="true" className="icon">{icons[name] ?? "·"}</span>;
}

/** Build the launch control dashboard.
 *
 * @returns The interactive launch control interface.
 */
export function App() {
  const [location, setLocation] = useState(window.location.hash || "#overview");
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  useEffect(() => {
    const onNavigate = () => setLocation(window.location.hash || "#overview");
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);
  return (
    <div className="app-shell">
      <Sidebar location={location} openCount={notifications?.filter(isOpen).length ?? null} />
      {location === "#agents" ? <AgentsPage /> : <Dashboard notifications={notifications} setNotifications={setNotifications} />}
    </div>
  );
}

/** Keep workspace navigation visible across tabs. */
function Sidebar({ location, openCount }: { location: string; openCount: number | null }) {
  const links = [
    ["#overview", "Overview"],
    ["#notifications", "Issues"],
    ["#agents", "Agents"],
  ];
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Linewatch home">Linewatch</a>
      <p className="side-project">Soony · Grand Heist 6</p>
      <nav className="main-nav" aria-label="Main navigation">
        {links.map(([href, label]) => (
          <a key={href} className={`nav-link${location === href ? " selected" : ""}`} href={href} aria-current={location === href ? "page" : undefined}>
            {label}
            {href === "#notifications" && !!openCount && <span className="nav-count">{openCount}</span>}
          </a>
        ))}
      </nav>
    </aside>
  );
}

/** Render the launch overview: data import and the agents' notifications. */
function Dashboard({ notifications, setNotifications }: { notifications: Notification[] | null; setNotifications: (items: Notification[]) => void }) {
  const [loading, setLoading] = useState(notifications === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setNotifications(await listNotifications());
  }, [setNotifications]);

  useEffect(() => {
    refresh()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load notifications."))
      .finally(() => setLoading(false));
    // Agents post findings in the background, so keep the list current.
    const timer = window.setInterval(() => { refresh().catch(() => undefined); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [loading]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...(notifications ?? [])]
      .filter((n) => showResolved || isOpen(n))
      .filter((n) => filter === "all" || severityOf(n) === filter)
      .filter((n) => !normalized || [n.data.title, n.data.details, n.data.kind, n.attr, n.erp_val, n.customer_val, ...(n.data.refs ?? [])].join(" ").toLowerCase().includes(normalized))
      .sort((a, b) => severityOrder.indexOf(severityOf(a)) - severityOrder.indexOf(severityOf(b)) || b.seen_at.localeCompare(a.seen_at));
  }, [notifications, filter, query, showResolved]);

  const counts = useMemo(() => {
    const initial: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
    for (const n of notifications ?? []) if (isOpen(n)) initial[severityOf(n)] += 1;
    return initial;
  }, [notifications]);

  async function handleSync() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sync = await syncPortal();
      const master = await importMaster();
      const sheets = await importSheets();
      const sheetRows = Object.values(sheets.rows).reduce((sum, count) => sum + count, 0);
      const failed = sync.failed.length ? ` ${sync.failed.length} files failed to download.` : "";
      setNotice(`Portal checked: ${sync.added.length} new, ${sync.changed.length} changed, ${sync.unchanged} unchanged.${failed} Loaded ${master.products} products, ${master.components} components and ${sheetRows} sheet rows.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Portal sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(notification: Notification, status: string) {
    setError(null);
    try {
      await updateNotificationData(notification.id, { ...notification.data, status });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the notification.");
    }
  }

  if (loading) return <div className="loading-screen"><p>Loading…</p></div>;
  if (notifications === null) return <div className="load-error"><h1>The backend is not reachable.</h1><p>{error ?? "Start the backend, then reload this page."}</p><button className="button button-primary" onClick={() => { setLoading(true); setError(null); refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load notifications.")).finally(() => setLoading(false)); }}>Try again</button></div>;

  const openTotal = counts.critical + counts.warning + counts.info;

  return (
    <main id="overview" className="main-content">
      <header className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="launch-line">Launch Sun 22 Nov, 20:00 at DC Hamburg · <strong>{timeToLaunch()}</strong></p>
        </div>
        <div className="page-actions">
          <button className="button button-outline" onClick={handleSync} disabled={busy} title="Download new portal files and reload the database">{busy ? "Syncing…" : "Sync portal data"}</button>
          <NotificationBell notifications={notifications} />
        </div>
      </header>
      <div className="content-wrap">

        {error && <div className="message message-error" role="alert"><Icon name="alert" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}
        {notice && <div className="message message-success" role="status"><Icon name="check" /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

        <section className="section-block priority-section" id="notifications" aria-labelledby="notifications-heading"><div className="list-head"><h2 id="notifications-heading">Open issues <span>{openTotal}</span></h2><p>Where the ERP disagrees with paperwork or suppliers, as reported by the agents.</p></div>
          <div className="priority-toolbar"><div className="filter-tabs" role="group" aria-label="Filter notifications">{(["all", ...severityOrder] as const).map((item) => <button key={item} className={`filter-tab ${filter === item ? "filter-active" : ""}`} onClick={() => setFilter(item)}>{item === "all" ? "All" : item}<span>{item === "all" ? openTotal : counts[item]}</span></button>)}<button className={`filter-tab ${showResolved ? "filter-active" : ""}`} onClick={() => setShowResolved((value) => !value)}>Resolved</button></div><label className="search-field"><Icon name="search" /><input aria-label="Search notifications" placeholder="Search a part, file or issue" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
          <div className="risk-list">{visible.length ? visible.map((n) => <NotificationCard key={n.id} notification={n} onStatus={setStatus} />) : <p className="list-empty">{notifications.length ? "Nothing matches this filter." : <>No issues reported yet. Ask an agent in <a href="#agents">Agents</a> to check the data.</>}</p>}</div>
        </section>
      </div>
    </main>
  );
}

/** Bell in the top bar: open-notification count and a dropdown of the latest ones. */
function NotificationBell({ notifications }: { notifications: Notification[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const openItems = notifications.filter(isOpen).sort((a, b) => b.seen_at.localeCompare(a.seen_at));
  const urgent = openItems.some((n) => severityOf(n) === "critical");

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="bell" ref={root}>
      <button className="bell-button" onClick={() => setOpen((value) => !value)} aria-label={`Notifications, ${openItems.length} open`} aria-expanded={open} aria-haspopup="true">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        {openItems.length > 0 && <span className={`bell-count${urgent ? " bell-urgent" : ""}`}>{openItems.length > 99 ? "99+" : openItems.length}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Latest notifications">
          <div className="bell-head"><strong>Notifications</strong><span>{openItems.length} open</span></div>
          {openItems.length ? (
            <ul className="bell-list">
              {openItems.slice(0, 6).map((n) => (
                <li key={n.id}>
                  <a href="#notifications" onClick={() => setOpen(false)}>
                    <i className={`bell-dot severity-${severityClass[severityOf(n)]}`} />
                    <span><strong>{n.data.title || `${n.attr} mismatch`}</strong><small>{severityOf(n)} · {localTime(n.seen_at)}</small></span>
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="bell-empty">Nothing open right now.</p>}
          <a className="bell-all" href="#notifications" onClick={() => setOpen(false)}>View all notifications →</a>
        </div>
      )}
    </div>
  );
}

/** Display one notification with its values, sources and status controls. */
function NotificationCard({ notification: n, onStatus }: { notification: Notification; onStatus: (n: Notification, status: string) => void }) {
  const severity = severityOf(n);
  const status = n.data.status ?? "open";
  return <article className={`risk-card risk-${severityClass[severity]}`}><div className="risk-accent" /><div className="risk-content"><div className="risk-topline"><span className={`severity-badge severity-${severityClass[severity]}`}><i />{severity}</span>{n.data.kind && <span className="risk-source-label">{n.data.kind}</span>}</div><h3>{n.data.title || `${n.attr} mismatch`}</h3><p className="risk-detail"><strong>{n.attr}:</strong> ERP {n.erp_val ?? "–"} vs customer side {n.customer_val ?? "–"}</p>{n.data.details && <p className="risk-detail">{n.data.details}</p>}{(n.data.refs ?? []).map((ref) => <div className="risk-evidence" key={ref}><Icon name="file" /><span>{ref}</span></div>)}</div><aside className="risk-next"><span>STATUS</span><p>{status.replace("_", " ")}{n.data.status_note ? ` · ${n.data.status_note}` : ""}</p><small>LAST SEEN · {localTime(n.seen_at)}</small>{status === "resolved" ? <button className="text-button" onClick={() => onStatus(n, "open")}>Reopen</button> : <button className="text-button" onClick={() => onStatus(n, "resolved")}><Icon name="check" /> Mark resolved</button>}</aside></article>;
}
