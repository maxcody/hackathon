import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getSkillRun, importMaster, importSheets, listNotifications, sendSolutionEmail, startSkillRun, syncPortal, updateNotificationData } from "./api";
import type { Notification, Severity, SkillRun, Solution } from "./types";
import { ComposeWindow } from "./EmailDraft";
import type { Draft } from "./EmailDraft";
import { AgentsPage } from "./AgentsPage";
import { ReadinessPanel } from "./ReadinessPanel";
import { InboxPage } from "./InboxPage";
import { DataPage } from "./DataPage";

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

/** Time left until launch, e.g. "16 h 40 min left". */
function timeToLaunch(): string {
  const minutes = Math.round((LAUNCH.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "launched";
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setNotifications(await listNotifications());
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Could not load issues.");
    }
  }, []);
  useEffect(() => {
    const onNavigate = () => setLocation(window.location.hash || "#overview");
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);
  useEffect(() => {
    void refresh();
    // Agents post findings in the background, so keep every page current.
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const issues = location === "#issues" || location.startsWith("#n-");
  let page;
  if (location === "#agents") page = <AgentsPage />;
  else if (location === "#inbox") page = <InboxPage />;
  else if (location === "#data") page = <DataPage notifications={notifications ?? []} />;
  else if (notifications === null) {
    page = loadError
      ? <div className="load-error"><h1>The backend is not reachable.</h1><p>{loadError}</p><button className="button button-primary" onClick={() => void refresh()}>Try again</button></div>
      : <div className="loading-screen"><p>Loading…</p></div>;
  } else if (issues) page = <IssuesPage notifications={notifications} refresh={refresh} focus={location.startsWith("#n-") ? location.slice(1) : null} />;
  else page = <Dashboard notifications={notifications} />;
  return (
    <div className="app-shell">
      <Sidebar location={issues ? "#issues" : location} />
      {page}
    </div>
  );
}

/** Line icons for the sidebar (16px, current color). */
const NAV_ICONS: Record<string, ReactNode> = {
  overview: <path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z" />,
  inbox: <><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></>,
  data: <><ellipse cx="12" cy="5.5" rx="8" ry="2.5" /><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" /></>,
  agents: <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M9 12.5v.01M15 12.5v.01M9.5 16h5" /></>,
};

/** Workspace navigation with the launch countdown (issues are reached via the bell). */
function Sidebar({ location }: { location: string }) {
  const links: [string, string, string][] = [
    ["#overview", "overview", "Overview"],
    ["#inbox", "inbox", "Inbox"],
    ["#data", "data", "Data"],
    ["#agents", "agents", "Agents"],
  ];
  const current = location === "#issues" ? "#overview" : location;
  return (
    <aside className="sidebar side">
      <a className="side-brand" href="#overview">Linewatch</a>
      <p className="side-project">Soony · Grand Heist 6</p>
      <nav className="side-nav" aria-label="Main navigation">
        {links.map(([href, icon, label]) => (
          <a key={href} className={`side-link${current === href ? " active" : ""}`} href={href} aria-current={current === href ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_ICONS[icon]}</svg>
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="side-foot">
        <span>Launch Sun 22 Nov, 20:00</span>
        <strong>{timeToLaunch()}</strong>
      </div>
    </aside>
  );
}

/** Top bar of the overview and issues pages, with the notification bell. */
function TopBar({ title, notifications }: { title: string; notifications: Notification[] }) {
  return <header className="topbar"><div className="ov-crumb">{title}</div><div className="topbar-right"><NotificationBell notifications={notifications} /><span className="top-divider" /><span className="top-avatar">S</span></div></header>;
}

/** Launch overview: countdown, data sync and readiness; issues live on their own page. */
function Dashboard({ notifications }: { notifications: Notification[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = notifications.filter(isOpen);
  const critical = open.filter((n) => severityOf(n) === "critical").length;

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

  return (
    <main id="overview" className="main-content">
      <TopBar title="Overview" notifications={notifications} />
      <div className="content-wrap">
        <section className="ov-head" aria-label="Launch">
          <div>
            <h1>Grand Heist 6 launch</h1>
            <p>Sun 22 Nov, 20:00 · DC Hamburg · <strong>{timeToLaunch()}</strong></p>
          </div>
          <button type="button" className="ov-sync" onClick={handleSync} disabled={busy} title="Download new portal files and reload the database">{busy ? "Syncing…" : "Sync portal data"}</button>
        </section>

        {error && <div className="message message-error" role="alert"><Icon name="alert" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}
        {notice && <div className="message message-success" role="status"><Icon name="check" /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

        <a className={`ov-issues${critical ? " ov-issues-critical" : ""}`} href="#issues">
          <strong>{open.length} open issues</strong>
          <span>{critical ? `${critical} critical · ` : ""}what the agents found, with proposed solutions</span>
          <em>View issues →</em>
        </a>

        <ReadinessPanel notifications={notifications} />
      </div>
    </main>
  );
}

/** Issues page: everything the agents found, with solutions, and the risk check. */
function IssuesPage({ notifications, refresh, focus }: { notifications: Notification[]; refresh: () => Promise<void>; focus: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ block: "start" });
  }, [focus]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...notifications]
      .filter((n) => showResolved || isOpen(n) || `n-${n.id}` === focus)
      .filter((n) => filter === "all" || severityOf(n) === filter)
      .filter((n) => !normalized || [n.data.title, n.data.details, n.data.kind, n.attr, n.erp_val, n.customer_val, ...(n.data.refs ?? [])].join(" ").toLowerCase().includes(normalized))
      .sort((a, b) => severityOrder.indexOf(severityOf(a)) - severityOrder.indexOf(severityOf(b)) || b.seen_at.localeCompare(a.seen_at));
  }, [notifications, filter, query, showResolved, focus]);

  const counts = useMemo(() => {
    const initial: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
    for (const n of notifications) if (isOpen(n)) initial[severityOf(n)] += 1;
    return initial;
  }, [notifications]);
  const openTotal = counts.critical + counts.warning + counts.info;

  async function setStatus(notification: Notification, status: string) {
    setError(null);
    try {
      await updateNotificationData(notification.id, { ...notification.data, status });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the issue.");
    }
  }

  return (
    <main id="issues" className="main-content">
      <TopBar title="Issues" notifications={notifications} />
      <div className="content-wrap">
        <section className="ov-head" aria-label="Issues">
          <div>
            <h1>Issues</h1>
            <p>Where the ERP disagrees with paperwork, suppliers or the launch plan, with proposed solutions.</p>
          </div>
          <RiskCheck onFinished={refresh} />
        </section>
        {error && <div className="message message-error" role="alert"><Icon name="alert" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}
        <section className="section-block priority-section" aria-label="Issue list">
          <div className="priority-toolbar"><div className="filter-tabs" role="group" aria-label="Filter issues">{(["all", ...severityOrder] as const).map((item) => <button key={item} className={`filter-tab ${filter === item ? "filter-active" : ""}`} onClick={() => setFilter(item)}>{item === "all" ? "All" : item}<span>{item === "all" ? openTotal : counts[item]}</span></button>)}<button className={`filter-tab ${showResolved ? "filter-active" : ""}`} onClick={() => setShowResolved((value) => !value)}>Resolved</button></div><label className="search-field"><Icon name="search" /><input aria-label="Search issues" placeholder="Search a part, file or issue" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
          <div className="nc-list">{visible.length ? visible.map((n) => <NotificationCard key={n.id} notification={n} onStatus={setStatus} onChanged={() => void refresh()} />) : <p className="list-empty">{notifications.length ? "Nothing matches this filter." : "No issues yet. Run the risk check to let an agent go through the data."}</p>}</div>
        </section>
      </div>
    </main>
  );
}

/** "Run risk check" with the status of the latest run (it takes a few minutes). */
function RiskCheck({ onFinished }: { onFinished: () => Promise<void> }) {
  const [run, setRun] = useState<SkillRun | null>(null);
  const [error, setError] = useState("");
  const running = run?.status === "running";

  useEffect(() => {
    let previous: string | undefined;
    const poll = () => getSkillRun("risk-check").then((value) => {
      if (previous === "running" && value.status !== "running") void onFinished();
      previous = value.status;
      setRun(value);
    }).catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, 10 * 1000);
    return () => window.clearInterval(timer);
  }, [onFinished]);

  async function start() {
    setError("");
    try { setRun(await startSkillRun("risk-check")); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the risk check."); }
  }

  const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  const status = running
    ? `Running since ${when(run?.started_at)} · takes a few minutes`
    : run?.status === "done" ? `Last run ${when(run.finished_at)}`
    : run?.status === "failed" ? `Last run failed: ${run.error ?? ""}`
    : "Not run yet";
  return (
    <div className="risk-run">
      <button type="button" className="ov-sync" onClick={() => void start()} disabled={running}>{running ? "Checking…" : "Run risk check"}</button>
      <small className={run?.status === "failed" || error ? "risk-run-bad" : ""} title={run?.summary || undefined}>{error || status}</small>
    </div>
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
                  <a href={`#n-${n.id}`} onClick={() => setOpen(false)}>
                    <i className={`bell-dot severity-${severityClass[severityOf(n)]}`} />
                    <span><strong>{n.data.title || `${n.attr} mismatch`}</strong><small>{severityOf(n)} · {localTime(n.seen_at)}</small></span>
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="bell-empty">Nothing open right now.</p>}
          <a className="bell-all" href="#issues" onClick={() => setOpen(false)}>View all issues →</a>
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