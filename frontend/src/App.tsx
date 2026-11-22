import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importMaster, importSheets, listNotifications, sendSolutionEmail, syncPortal, updateNotificationData } from "./api";
import type { Notification, Severity, Solution } from "./types";
import { ComposeWindow } from "./EmailDraft";
import type { Draft } from "./EmailDraft";
import { AgentsPage } from "./AgentsPage";
import { ReadinessPanel } from "./ReadinessPanel";
import { InboxPage } from "./InboxPage";

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
    search: "⌕", spark: "✳", alert: "!", mail: "✉",
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
      {location === "#agents" ? <AgentsPage /> : location === "#inbox" ? <InboxPage /> : <Dashboard notifications={notifications} setNotifications={setNotifications} />}
    </div>
  );
}

/** Keep workspace navigation visible across tabs. */
function Sidebar({ location, openCount }: { location: string; openCount: number | null }) {
  const links = [
    ["#overview", "grid", "Overview"],
    ["#notifications", "alert", "Notifications"],
    ["#agents", "spark", "Agents"],
    ["#inbox", "mail", "Inbox"],
  ];
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Linewatch home"><span className="brand-mark">L</span><span>linewatch<span className="brand-period">.</span></span></a>
      <div className="side-caption">YOUR WORKSPACE</div>
      <div className="workspace-switch"><span className="workspace-icon">S</span><span><strong>Soony Interactive</strong><small>Grand Heist 6</small></span><span className="down-caret">⌄</span></div>
      <div className="side-caption nav-caption">LAUNCH CONTROL</div>
      <nav className="main-nav" aria-label="Main navigation">
        {links.map(([href, icon, label]) => (
          <a key={href} className={`nav-link${location === href ? " selected" : ""}`} href={href} aria-label={label} aria-current={location === href ? (href === "#agents" || href === "#inbox" ? "page" : "location") : undefined}>
            <Icon name={icon} /> {label}
            {href === "#notifications" && openCount !== null && <span className="nav-count">{openCount}</span>}
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="profile-row"><div className="profile-avatar">S</div><div><strong>Launch team</strong><small>Soony workspace</small></div><span className="profile-menu">•••</span></div>
      </div>
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

  if (loading) return <div className="loading-screen"><div className="loading-mark">L</div><p>Getting the launch picture…</p></div>;
  if (notifications === null) return <div className="load-error"><div className="brand-mark">L</div><h1>We can’t reach Linewatch yet.</h1><p>{error ?? "Start the backend, then reload this page."}</p><button className="button button-primary" onClick={() => { setLoading(true); setError(null); refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load notifications.")).finally(() => setLoading(false)); }}>Try again</button></div>;

  const openTotal = counts.critical + counts.warning + counts.info;

  return (
    <main id="overview" className="main-content">
      <header className="topbar"><div className="mobile-brand"><span className="brand-mark">L</span> linewatch<span className="brand-period">.</span></div><div className="breadcrumbs">Workspaces <span>/</span> Soony <span>/</span> <strong>Launch overview</strong></div><div className="topbar-right"><span className="live-badge"><i /> LIVE VIEW</span><NotificationBell notifications={notifications} /><span className="top-divider" /><span className="top-avatar">S</span></div></header>
      <div className="content-wrap">
        <section className="hero-row">
          <div><div className="eyebrow"><span className="eyebrow-mark" /> RELEASE OPERATIONS <span className="eyebrow-slash">/</span> 01</div><h1>Keep the line <em>running.</em></h1><p className="hero-subtitle">What the agents found in the data, and what needs a person right now.</p></div>
          <a className="button button-dark" href="#agents"><Icon name="spark" /> Open agents</a>
        </section>

        <section className="deadline-banner" aria-label="Launch deadline"><div className="deadline-symbol"><Icon name="clock" /></div><div className="deadline-copy"><span className="banner-overline">FIXED LAUNCH DEADLINE <span className="banner-dot" /> NON-NEGOTIABLE</span><strong>Grand Heist 6 launches <b>Sunday, 22 November at 20:00</b></strong><small>Every copy must be packed and ready at the Hamburg distribution center.</small></div><div className="deadline-location"><span>FULFILMENT SITE</span><strong>Hamburg <small>· DC-HAM</small></strong><span className="location-note">One site · no alternate</span></div></section>

        <section className="data-toolbar" aria-label="Portal sync"><div className="data-summary"><div className="data-icon ready"><Icon name="file" /></div><div><div className="data-title-row"><strong>Soony portal data</strong></div><p>Download new or changed portal files, then reload products, components, BOM and sheet rows into the database.</p></div></div><div className="toolbar-actions"><button className="button button-sync" onClick={handleSync} disabled={busy}><Icon name="refresh" /> {busy ? "Syncing…" : "Sync and import"}</button></div></section>

        {error && <div className="message message-error" role="alert"><Icon name="alert" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}
        {notice && <div className="message message-success" role="status"><Icon name="check" /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

        <ReadinessPanel notifications={notifications} />

        <section className="section-block priority-section" id="notifications" aria-labelledby="notifications-heading"><div className="section-heading"><div><span className="section-number">01</span><div><h2 id="notifications-heading">What needs a human now</h2><p>Mismatches the agents found between the ERP and the paper or supplier side. Check the sources before acting.</p></div></div><span className="priority-total">{openTotal} <small>open</small></span></div>
          <div className="priority-toolbar"><div className="filter-tabs" role="group" aria-label="Filter notifications">{(["all", ...severityOrder] as const).map((item) => <button key={item} className={`filter-tab ${filter === item ? "filter-active" : ""}`} onClick={() => setFilter(item)}>{item === "all" ? "All" : item}<span>{item === "all" ? openTotal : counts[item]}</span></button>)}<button className={`filter-tab ${showResolved ? "filter-active" : ""}`} onClick={() => setShowResolved((value) => !value)}>Resolved</button></div><label className="search-field"><Icon name="search" /><input aria-label="Search notifications" placeholder="Search a part, file or issue" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
          <div className="nc-list">{visible.length ? visible.map((n) => <NotificationCard key={n.id} notification={n} onStatus={setStatus} onChanged={() => { refresh().catch(() => undefined); }} />) : <div className="empty-state"><div className="empty-symbol"><Icon name="check" /></div><strong>{notifications.length ? "No matching notifications" : "No notifications yet"}</strong><p>{notifications.length ? "Try another filter or search term." : "Ask an agent in the Agents tab to check the data; its findings appear here."}</p></div>}</div>
        </section>

        <footer className="page-footer"><span><b>LINEWATCH</b> <i>·</i> SOONY LAUNCH CONTROL</span><span>Evidence first. Human decisions always.</span></footer>
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

/** Display one notification: what differs, why it matters, how to solve it. */
function NotificationCard({ notification: n, onStatus, onChanged }: { notification: Notification; onStatus: (n: Notification, status: string) => void; onChanged: () => void }) {
  const severity = severityOf(n);
  const status = n.data.status ?? "open";
  const refs = n.data.refs ?? [];
  const kind = (n.data.kind ?? "").replace(/_/g, " ");
  return (
    <article id={`n-${n.id}`} className={`nc nc-${severity}${status === "resolved" ? " nc-resolved" : ""}`}>
      <header className="nc-head">
        <div className="nc-title">
          <span className="nc-meta"><i className="nc-dot" />{severity}{kind && <> · {kind}</>}</span>
          <h3>{n.data.title || `${n.attr} mismatch`}</h3>
        </div>
        <div className="nc-actions">
          <span className={`nc-status nc-status-${status}`}>{status.replace("_", " ")}</span>
          <button type="button" className="nc-resolve" onClick={() => onStatus(n, status === "resolved" ? "open" : "resolved")}>{status === "resolved" ? "Reopen" : "Resolve"}</button>
        </div>
      </header>
      {(n.erp_val || n.customer_val) && (
        <div className="nc-compare">
          <div><span>ERP · {n.attr.replace(/_/g, " ")}</span><strong>{n.erp_val ?? "–"}</strong></div>
          <div><span>Actual</span><strong>{n.customer_val ?? "–"}</strong></div>
        </div>
      )}
      {n.data.details && <p className="nc-details">{n.data.details}</p>}
      {(n.data.solutions ?? []).length > 0 && <SolutionList notification={n} onChanged={onChanged} />}
      <footer className="nc-foot">
        {refs.length > 0 && <details className="nc-sources"><summary>{refs.length} {refs.length === 1 ? "source" : "sources"}</summary><ul>{refs.map((ref) => <li key={ref}>{ref}</li>)}</ul></details>}
        <span>Last seen {localTime(n.seen_at)}{n.data.status_note ? ` · ${n.data.status_note}` : ""}</span>
      </footer>
    </article>
  );
}
const SOLUTION_KIND: Record<Solution["kind"], string> = { email: "Email", claim: "Claim", internal: "Internal", decision: "Decision" };

/** Proposed solutions of a notification; email solutions open a review popup. */
function SolutionList({ notification, onChanged }: { notification: Notification; onChanged: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const solutions = notification.data.solutions ?? [];
  return (
    <div className="sols">
      <h4>How to solve it</h4>
      <ol>
        {solutions.map((solution, index) => (
          <li key={index} className={`sol sol-${solution.kind}`}>
            <span className="sol-kind">{SOLUTION_KIND[solution.kind] ?? solution.kind}</span>
            <div className="sol-main">
              <strong>{solution.title}</strong>
              <p>{solution.description}</p>
              <small>{[solution.owner, solution.deadline && `by ${solution.deadline}`, solution.cost].filter(Boolean).join(" · ")}</small>
              {solution.approval && <small className="sol-approval">Approval: {solution.approval}</small>}
            </div>
            {solution.email && (solution.status === "sent"
              ? <button type="button" className="sol-sent" onClick={() => setOpen(index)}>✓ Sent</button>
              : <button type="button" className="sol-action" onClick={() => setOpen(index)}>Review email</button>)}
          </li>
        ))}
      </ol>
      {open !== null && solutions[open] && <SolutionEmailDialog notification={notification} index={open} solution={solutions[open]} onClose={() => setOpen(null)} onSent={() => { setOpen(null); onChanged(); }} />}
    </div>
  );
}

/** Popup to review, edit, approve and send a solution's email. */
function SolutionEmailDialog({ notification, index, solution, onClose, onSent }: { notification: Notification; index: number; solution: Solution; onClose: () => void; onSent: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const sent = solution.status === "sent" ? solution.sent_email : undefined;
  const email = sent ?? solution.email;
  if (!email) return null;
  const draft: Draft = { to: email.to, cc: email.cc ?? [], subject: email.subject, body: email.body };

  async function send(edited: Draft, approvedBy?: string) {
    setBusy(true);
    setError("");
    try {
      await sendSolutionEmail(notification.id, index, { ...edited, approved_by: approvedBy });
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="solution-dialog" onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <ComposeWindow context={notification.data.title ?? ""} title={solution.title} draft={draft} translation={solution.email?.translation} approval={sent ? undefined : solution.approval} busy={busy} error={error} onClose={() => dialog.current?.close()} onSend={sent ? undefined : (edited, approvedBy) => void send(edited, approvedBy)} status={sent ? `Sent${solution.approved_by ? ` · approved by ${solution.approved_by}` : ""}` : undefined} />
    </dialog>
  );
}