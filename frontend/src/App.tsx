import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrief, getSupplierDraft, importArchive, runAgents, syncPortal } from "./api";
import type { LaunchBrief, Risk, Severity } from "./types";

const number = new Intl.NumberFormat("en-US");
const severityOrder: Severity[] = ["critical", "high", "medium", "low"];

/** Format numeric quantities consistently across the dashboard. */
function quantity(value: number): string {
  return number.format(value);
}

/** Format a timestamp for the viewer's local timezone. */
function localTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

/** Render a compact visual symbol with an accessible label. */
function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    grid: "▦", pulse: "⌁", file: "▤", clock: "◷", arrow: "↗",
    refresh: "↻", upload: "↑", check: "✓", search: "⌕", spark: "✳",
    box: "▣", alert: "!", close: "×", menu: "☰", external: "↗",
  };
  return <span aria-hidden="true" className="icon">{icons[name] ?? "·"}</span>;
}

/** Build a draft, evidence-led launch control dashboard.
 *
 * @returns The interactive launch control interface.
 */
export function App() {
  const [brief, setBrief] = useState<LaunchBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"sync" | "import" | "agents" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [query, setQuery] = useState("");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showAllRisks, setShowAllRisks] = useState(false);
  const [draft, setDraft] = useState<{ title: string; to: string; subject: string; body: string } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setBrief(await getBrief());
  }, []);

  useEffect(() => {
    getBrief()
      .then(setBrief)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the launch brief."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!brief?.data?.portal_sync_enabled) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await syncPortal();
        if (result.changed_count > 0) {
          setBrief(await runAgents());
          setNotice(`${result.changed_count} file changes found. Priorities refreshed.`);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Automatic portal check failed.");
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [brief?.data?.portal_sync_enabled]);

  const risks = useMemo(() => {
    if (!brief) return [];
    const normalized = query.trim().toLowerCase();
    return [...brief.risks]
      .sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity))
      .filter((risk) => filter === "all" || risk.severity === filter)
      .filter((risk) => !normalized || [risk.title, risk.detail, risk.evidence, risk.action, risk.owner ?? ""].join(" ").toLowerCase().includes(normalized));
  }, [brief, filter, query]);

  async function handleSync() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const result = await syncPortal();
      if (result.changed_count > 0) {
        setBrief(await runAgents());
        setNotice(`Portal checked. ${result.changed_count} changed files downloaded and priorities refreshed.`);
      } else {
        await refresh();
        setNotice("Portal checked. No new or changed files; your latest snapshot is already current.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Portal sync failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const result = await importArchive(file);
      setBrief(await runAgents());
      setNotice(`Imported ${result.file_count} files. Found ${result.changed_count} changes since the last snapshot.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Archive import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRunAgents() {
    setBusy("agents");
    setError(null);
    try {
      setBrief(await runAgents());
      setNotice("Launch brief refreshed from the latest available evidence.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh the launch brief.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDraft(edition: string) {
    try {
      const result = await getSupplierDraft(edition);
      setDraft({ title: `${edition} supplier follow-up`, ...result });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the draft.");
    }
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setNotice("Draft copied. Confirm the right supplier and contact before sending.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the draft text instead.");
    }
  }

  const counts = useMemo(() => {
    const initial: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const risk of brief?.risks ?? []) initial[risk.severity] += 1;
    return initial;
  }, [brief?.risks]);
  const visibleRisks = showAllRisks ? risks : risks.slice(0, 8);

  if (loading) return <div className="loading-screen"><div className="loading-mark">L</div><p>Getting the launch picture…</p></div>;
  if (!brief) return <div className="load-error"><div className="brand-mark">L</div><h1>We can’t reach Linewatch yet.</h1><p>{error ?? "Start the backend, then reload this page."}</p><button className="button button-primary" onClick={() => { setLoading(true); getBrief().then(setBrief).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the launch brief.")).finally(() => setLoading(false)); }}>Try again</button></div>;

  const imported = brief.data?.imported ?? false;
  const completion = Math.max(0, Math.min(100, brief.summary.completion_pct));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Linewatch home"><span className="brand-mark">L</span><span>linewatch<span className="brand-period">.</span></span></a>
        <div className="side-caption">YOUR WORKSPACE</div>
        <div className="workspace-switch"><span className="workspace-icon">S</span><span><strong>Soony Interactive</strong><small>Grand Heist 6</small></span><span className="down-caret">⌄</span></div>
        <div className="side-caption nav-caption">LAUNCH CONTROL</div>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-link selected" href="#overview"><Icon name="grid" /> Overview</a>
          <a className="nav-link" href="#priorities"><Icon name="alert" /> Priorities <span className="nav-count">{brief.risks.length}</span></a>
          <a className="nav-link" href="#changes"><Icon name="pulse" /> Data changes</a>
          <a className="nav-link" href="#evidence"><Icon name="file" /> Evidence & sources</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card"><span className={`connection-dot ${imported ? "connected" : ""}`} /><div><strong>{imported ? "Data connected" : "Waiting for data"}</strong><small>{imported ? `${brief.data?.file_count ?? 0} files indexed` : "Import a portal archive"}</small></div></div>
          <div className="profile-row"><div className="profile-avatar">S</div><div><strong>Launch team</strong><small>Soony workspace</small></div><span className="profile-menu">•••</span></div>
        </div>
      </aside>

      <main id="overview" className="main-content">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">L</span> linewatch<span className="brand-period">.</span></div><div className="breadcrumbs">Workspaces <span>/</span> Soony <span>/</span> <strong>Launch overview</strong></div><div className="topbar-right"><span className="live-badge"><i /> LIVE VIEW</span><span className="top-divider" /><span className="top-avatar">S</span></div></header>
        <div className="content-wrap">
          <section className="hero-row">
            <div><div className="eyebrow"><span className="eyebrow-mark" /> RELEASE OPERATIONS <span className="eyebrow-slash">/</span> 01</div><h1>Keep the line <em>running.</em></h1><p className="hero-subtitle">A clear view of what is ready, what is at risk, and what needs a person right now.</p></div>
            <button className="button button-dark" onClick={handleRunAgents} disabled={busy !== null}><Icon name="spark" /> {busy === "agents" ? "Updating…" : "Refresh launch brief"}</button>
          </section>

          <section className="deadline-banner" aria-label="Launch deadline"><div className="deadline-symbol"><Icon name="clock" /></div><div className="deadline-copy"><span className="banner-overline">FIXED LAUNCH DEADLINE <span className="banner-dot" /> NON-NEGOTIABLE</span><strong>Grand Heist 6 launches <b>Sunday, 22 November at 20:00</b></strong><small>Every copy must be packed and ready at the Hamburg distribution center.</small></div><div className="deadline-location"><span>FULFILMENT SITE</span><strong>Hamburg <small>· DC-HAM</small></strong><span className="location-note">One site · no alternate</span></div></section>

          <section className="data-toolbar" aria-label="Data import and sync"><div className="data-summary"><div className={`data-icon ${imported ? "ready" : ""}`}><Icon name="file" /></div><div><div className="data-title-row"><strong>{imported ? "Procurement data loaded" : "Start with the Soony data"}</strong><span className={`data-state ${imported ? "state-ready" : ""}`}><i /> {imported ? "SNAPSHOT READY" : "NO SNAPSHOT"}</span></div><p>{imported ? `${quantity(brief.data?.file_count ?? 0)} files · ${quantity(brief.data?.row_count ?? 0)} rows · Last loaded ${localTime(brief.data?.imported_at)}` : "Import the downloaded portal ZIP to index orders, suppliers and delivery records."}</p>{imported && (brief.data?.warning_count ?? 0) > 0 && <small className="parser-note"><Icon name="alert" /> {brief.data?.warning_count} files need a closer look because their contents could not be fully read.</small>}</div></div><div className="toolbar-actions"><label className={`button button-outline ${busy === "import" ? "is-disabled" : ""}`}><Icon name="upload" /> {busy === "import" ? "Importing…" : "Import ZIP"}<input type="file" accept=".zip,application/zip" onChange={(event) => { void handleImport(event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={busy !== null} /></label><button className="button button-sync" onClick={handleSync} disabled={busy !== null}><Icon name="refresh" /> {busy === "sync" ? "Checking portal…" : "Sync portal"}</button></div></section>

          {error && <div className="message message-error" role="alert"><Icon name="alert" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}
          {notice && <div className="message message-success" role="status"><Icon name="check" /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

          {brief.operating_priorities && brief.operating_priorities.length > 0 && <section className="operating-rules" aria-label="Current operating rules"><div className="rules-heading"><span className="rules-mark"><Icon name="alert" /></span><div><strong>Today's operating rules</strong><span>From the latest CPO memo · follow these when making launch decisions</span></div></div><div className="rules-grid">{brief.operating_priorities.map((rule) => <article className="rule-item" key={rule.title}><strong>{rule.title}</strong><p>{rule.detail}</p><small>{rule.source}</small></article>)}</div></section>}

          <section className="section-block" aria-labelledby="readiness-heading"><div className="section-heading"><div><span className="section-number">01</span><div><h2 id="readiness-heading">Launch readiness</h2><p>The day-one production picture at a glance.</p></div></div><span className="baseline-chip"><span /> {imported ? (brief.editions.some((edition) => edition.hours_needed != null) ? "LATEST LAUNCH STATUS" : "LIVE DATA + KICKOFF BASELINE") : "KICKOFF BASELINE"}</span></div>
            <div className="kpi-grid">
              <article className="kpi-card kpi-total"><div className="kpi-label">DAY-ONE REQUIREMENT <span className="kpi-icon"><Icon name="box" /></span></div><strong>{quantity(brief.summary.required)}</strong><p>copies across both editions</p><div className="kpi-accent-line" /></article>
              <article className="kpi-card kpi-packed"><div className="kpi-label">PACKED SO FAR <span className="kpi-icon"><Icon name="check" /></span></div><strong>{quantity(brief.summary.packed)}</strong><div className="progress-rail"><span style={{ width: `${completion}%` }} /></div><p><b>{brief.summary.completion_pct}%</b> of total demand is packed</p></article>
              <article className="kpi-card kpi-gap"><div className="kpi-label">STILL TO PACK <span className="attention-chip">NEEDS ATTENTION</span></div><strong>{quantity(brief.summary.remaining)}</strong><p>copies remain before launch</p><span className="gap-watermark">↗</span></article>
            </div>
          </section>

          <section className="section-block edition-section" aria-labelledby="edition-heading"><div className="section-heading"><div><span className="section-number">02</span><div><h2 id="edition-heading">Where the gap is</h2><p>Progress toward the required quantity for each edition.</p></div></div><span className="quiet-label">PACKED / REQUIRED</span></div>
            <div className="edition-grid">{brief.editions.map((edition) => { const collector = edition.edition.toLowerCase().includes("collector"); return <article className={`edition-card ${collector ? "edition-collector" : ""}`} key={edition.edition}><div className="edition-card-head"><div className={`edition-badge ${collector ? "collector-badge" : "standard-badge"}`}>{collector ? "C" : "S"}</div><div className="edition-title"><h3>{edition.edition}</h3><span>{collector ? "NUMBERED · ALL PRE-ORDERED" : "STANDARD RELEASE"}</span></div><span className={`edition-pct ${collector ? "pct-amber" : "pct-green"}`}>{edition.completion_pct}%</span></div><div className="edition-progress"><div className="edition-progress-head"><span>Production complete</span><strong>{quantity(edition.packed)} <small>/ {quantity(edition.required)}</small></strong></div><div className="progress-rail"><span style={{ width: `${Math.max(0, Math.min(100, edition.completion_pct))}%` }} /></div></div><div className="edition-remaining"><span>Still to pack</span><strong>{quantity(edition.remaining)} <small>copies</small></strong></div>{edition.hours_needed != null && <div className="edition-hours">At the current rate: <strong>{edition.hours_needed} hours</strong> of line time</div>}</article>; })}</div>
          </section>

          <section className="section-block priority-section" id="priorities" aria-labelledby="priority-heading"><div className="section-heading"><div><span className="section-number">03</span><div><h2 id="priority-heading">What needs a human now</h2><p>Signals from your files. Check the evidence before acting.</p></div></div><span className="priority-total">{brief.risks.length} <small>signals</small></span></div>
            <div className="priority-toolbar"><div className="filter-tabs" role="group" aria-label="Filter priorities">{(["all", ...severityOrder] as const).map((item) => <button key={item} className={`filter-tab ${filter === item ? "filter-active" : ""}`} onClick={() => setFilter(item)}>{item === "all" ? "All" : item}<span>{item === "all" ? brief.risks.length : counts[item]}</span></button>)}</div><label className="search-field"><Icon name="search" /><input aria-label="Search priorities" placeholder="Search a supplier, file or issue" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
            <div className="risk-list">{risks.length ? visibleRisks.map((risk, index) => <RiskCard key={`${risk.title}-${risk.evidence}-${index}`} risk={risk} onDraft={handleDraft} />) : <div className="empty-state"><div className="empty-symbol"><Icon name="check" /></div><strong>No matching priorities</strong><p>Try another filter or search term.</p></div>}</div>
            {risks.length > 8 && <button className="show-more risk-show-more" onClick={() => setShowAllRisks((value) => !value)}>{showAllRisks ? "Show fewer priorities" : `Show ${risks.length - 8} more priorities`} <span>{showAllRisks ? "↑" : "↓"}</span></button>}
          </section>

          <section className="section-block changes-section" id="changes" aria-labelledby="changes-heading"><div className="section-heading"><div><span className="section-number">04</span><div><h2 id="changes-heading">What changed in the data</h2><p>New and updated source files detected between snapshots.</p></div></div><span className="quiet-label">{brief.events.length ? `${brief.events.length} RECENT` : "NO CHANGES YET"}</span></div><div className="changes-card">{brief.events.length ? <><div className="changes-card-head"><span>CHANGE</span><span>FILE & SOURCE</span><span>DETECTED</span></div>{(showAllEvents ? brief.events : brief.events.slice(0, 6)).map((event, index) => <div className="change-row" key={`${event.path}-${event.detected_at}-${index}`}><span className={`event-kind kind-${event.kind}`}>{event.kind}</span><div className="change-file"><strong>{event.summary}</strong><span>{event.path}</span></div><time>{localTime(event.detected_at)}</time></div>)}{brief.events.length > 6 && <button className="show-more" onClick={() => setShowAllEvents((value) => !value)}>{showAllEvents ? "Show fewer changes" : `Show ${brief.events.length - 6} more changes`} <span>{showAllEvents ? "↑" : "↓"}</span></button>}</> : <div className="no-changes"><span className="no-changes-icon"><Icon name="check" /></span><div><strong>No file changes recorded yet</strong><p>After the portal adds or updates a file, sync will show it here.</p></div></div>}</div></section>

          <section className="section-block agents-section" aria-labelledby="agents-heading"><div className="section-heading"><div><span className="section-number">05</span><div><h2 id="agents-heading">What the analysis checked</h2><p>Automated checks organize evidence; people make the decisions.</p></div></div><button className="text-button" onClick={handleRunAgents} disabled={busy !== null}><Icon name="refresh" /> Refresh</button></div><div className="agent-grid">{brief.agents.map((agent) => <article className="agent-card" key={agent.name}><span className={`agent-status ${agent.status === "complete" ? "agent-done" : agent.status === "waiting_for_data" ? "agent-waiting" : "agent-review"}`}><Icon name={agent.status === "complete" ? "check" : "alert"} /></span><div><div className="agent-title-row"><h3>{agent.name}</h3><span>{agent.status === "complete" ? "READY" : agent.status === "waiting_for_data" ? "WAITING" : "HUMAN REVIEW"}</span></div><p>{agent.result}</p></div></article>)}</div></section>

          <section className="evidence-panel" id="evidence"><div className="evidence-copy"><span className="evidence-icon"><Icon name="file" /></span><div><span className="evidence-overline">EVIDENCE & LIMITS</span><h2>Know what the signal is based on.</h2><p>Each priority links to a source file or the kickoff baseline. The system cannot read every scan, and it does not send supplier emails.</p></div></div><div className="evidence-facts"><div><strong>{brief.sources.reduce((sum, source) => sum + source.facts.length, 0)}</strong><span>source facts in use</span></div><div><strong>{brief.data?.warning_count ?? 0}</strong><span>files to review by hand</span></div><div><strong>{brief.limitations.length}</strong><span>known limitations</span></div></div>{brief.limitations.length > 0 && <details className="limitations"><summary>Read limitations</summary><ul>{brief.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}</section>
          <footer className="page-footer"><span><b>LINEWATCH</b> <i>·</i> SOONY LAUNCH CONTROL</span><span>Evidence first. Human decisions always.</span></footer>
        </div>
      </main>

      {draft && <div className="modal-backdrop" role="presentation" onClick={() => setDraft(null)}><section className="draft-modal" role="dialog" aria-modal="true" aria-labelledby="draft-heading" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setDraft(null)} aria-label="Close draft">×</button><span className="modal-kicker">SUPPLIER FOLLOW-UP · DRAFT ONLY</span><h2 id="draft-heading">{draft.title}</h2><div className="draft-warning"><Icon name="alert" /> Confirm supplier ownership and recipient before sending. Nothing is sent from Linewatch.</div><div className="draft-meta"><span>TO</span><strong>{draft.to}</strong></div><div className="draft-meta"><span>SUBJECT</span><strong>{draft.subject}</strong></div><pre>{draft.body}</pre><button className="button button-dark draft-copy" onClick={() => void copyDraft()}>Copy draft</button></section></div>}
    </div>
  );
}

/** Display one priority with its severity, evidence and next step. */
function RiskCard({ risk, onDraft }: { risk: Risk; onDraft: (edition: string) => void }) {
  const edition = risk.title.startsWith("Collector") ? "Collector's Edition" : risk.title.startsWith("Standard edition") ? "Standard" : null;
  return <article className={`risk-card risk-${risk.severity}`}><div className="risk-accent" /><div className="risk-content"><div className="risk-topline"><span className={`severity-badge severity-${risk.severity}`}><i />{risk.severity}</span><span className="risk-source-label"><Icon name="file" /> Evidence linked</span></div><h3>{risk.title}</h3><p className="risk-detail">{risk.detail}</p><div className="risk-evidence"><Icon name="file" /><span>{risk.evidence}</span></div>{edition && <button className="risk-draft-link" onClick={() => onDraft(edition)}>Prepare a follow-up draft <Icon name="arrow" /></button>}</div><aside className="risk-next"><span>NEXT STEP</span><p>{risk.action}</p><small>OWNER · {risk.owner || "Needs assignment"}</small></aside></article>;
}
