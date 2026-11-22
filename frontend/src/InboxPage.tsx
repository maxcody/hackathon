import { useCallback, useEffect, useMemo, useState } from "react";
import { getMailbox, reanalyzeEmail } from "./api";
import type { MailMessage, Mailbox } from "./types";
import "./inbox.css";

const REFRESH_MS = 30 * 1000;
const STATUS_LABEL: Record<string, string> = {
  requests: "Accepted", deferred: "Delayed", delivered: "Delivered", opened: "Opened", clicks: "Clicked",
  softBounces: "Soft bounce", hardBounces: "Bounced", blocked: "Blocked", invalid: "Invalid address", error: "Error", spam: "Marked as spam",
};
const STATUS_TONE: Record<string, string> = { delivered: "ok", opened: "ok", clicks: "ok", requests: "wait", deferred: "wait" };

/** Short time label: today shows the time, older mail the date. */
function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Analysis state of a received mail in the list. */
function AnalysisChip({ message }: { message: MailMessage }) {
  if (message.direction !== "in") return null;
  const status = message.analysis?.status;
  const [tone, label] = status === "done" ? ["ok", "Analyzed"] : status === "failed" ? ["bad", "Analysis failed"] : ["wait", "Analyzing…"];
  return <span className={`inbox-status inbox-status-${tone}`}>{label}</span>;
}

/** The agent's reading of a received mail: summary, commitments, risks, next step. */
function AnalysisPanel({ message, onRetry }: { message: MailMessage; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const analysis = message.analysis;
  async function retry() {
    setBusy(true);
    try { await reanalyzeEmail(message.message_id); onRetry(); } finally { setBusy(false); }
  }
  if (!analysis || analysis.status === "running") {
    return <section className="mail-ai mail-ai-wait"><strong>Agent analysis</strong><p>An agent is reading this email. The analysis appears here in a minute or two.</p></section>;
  }
  if (analysis.status === "failed") {
    return <section className="mail-ai mail-ai-bad"><strong>Agent analysis failed</strong><p>{analysis.error}</p><button type="button" onClick={() => void retry()} disabled={busy}>{busy ? "Restarting…" : "Analyze again"}</button></section>;
  }
  return (
    <section className="mail-ai">
      <div className="mail-ai-head"><strong>Agent analysis</strong>{analysis.language && <span>{analysis.language.toUpperCase()}</span>}<button type="button" onClick={() => void retry()} disabled={busy}>{busy ? "Restarting…" : "Analyze again"}</button></div>
      <p className="mail-ai-summary">{analysis.summary}</p>
      {analysis.commitments.length > 0 && (
        <ul className="mail-ai-commitments">
          {analysis.commitments.map((c, index) => <li key={index}><strong>{c.what}</strong>{[c.quantity, c.date, c.price].filter(Boolean).length > 0 && <span>{[c.quantity, c.date, c.price].filter(Boolean).join(" · ")}</span>}</li>)}
        </ul>
      )}
      {analysis.risks && <p className="mail-ai-risk"><strong>Risk:</strong> {analysis.risks}</p>}
      {analysis.next_step && <p className="mail-ai-next"><strong>Next step:</strong> {analysis.next_step}</p>}
      {analysis.notification_keys.length > 0 && <p className="mail-ai-links">Updated issues: {analysis.notification_keys.map((key) => <a key={key} href="#notifications">{key}</a>)}</p>}
      {analysis.translation && <details className="mail-ai-translation"><summary>English translation</summary><p>{analysis.translation}</p></details>}
    </section>
  );
}

/** Delivery status chip for outgoing mail. */
function StatusChip({ message }: { message: MailMessage }) {
  if (!message.status) return null;
  return <span className={`inbox-status inbox-status-${STATUS_TONE[message.status] ?? "bad"}`}>{STATUS_LABEL[message.status] ?? message.status}</span>;
}

/** Inbox tab: sent mail with delivery status, and received mail once connected. */
export function InboxPage() {
  const [box, setBox] = useState<Mailbox | null>(null);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState<"all" | "in" | "out">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBox(await getMailbox());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the inbox.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const messages = useMemo(() => (box?.messages ?? []).filter((m) => folder === "all" || m.direction === folder), [box, folder]);
  const open = messages.find((m) => m.message_id === selected) ?? messages[0];
  const original = open?.in_reply_to ? box?.messages.find((m) => m.message_id === open.in_reply_to) : undefined;

  return (
    <main className="main-content inbox-page" id="inbox">
      <header className="inbox-toolbar">
        <h1>Inbox</h1>
        <div className="inbox-folders" role="tablist">
          {([["all", "All"], ["in", "Received"], ["out", "Sent"]] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={folder === key} className={folder === key ? "active" : ""} onClick={() => setFolder(key)}>
              {label} <span>{(box?.messages ?? []).filter((m) => key === "all" || m.direction === key).length}</span>
            </button>
          ))}
        </div>
        {box?.sender && <span className="inbox-account">{box.sender}</span>}
        <button type="button" className="inbox-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh inbox"><span aria-hidden="true" className={loading ? "spinning" : ""}>↻</span> {loading ? "Refreshing…" : "Refresh"}</button>
      </header>
      {error && <p className="message message-error" role="alert">{error}</p>}
      {box && !box.incoming_configured && folder !== "out" && <p className="inbox-notice">Received mail is not connected yet. Supplier replies go to {box.sender ?? "the sender address"}; connect it with the Gmail Apps Script (see README, "Inbox").</p>}
      {box?.incoming_error && <p className="inbox-notice inbox-notice-error">{box.incoming_error}</p>}
      <div className="inbox-panes">
        <ul className="inbox-list" aria-label="Messages">
          {!box && !error && <li className="inbox-empty">Loading…</li>}
          {box && messages.length === 0 && <li className="inbox-empty">No messages.</li>}
          {messages.map((m) => (
            <li key={m.message_id}>
              <button type="button" className={`inbox-item${open?.message_id === m.message_id ? " selected" : ""}`} onClick={() => setSelected(m.message_id)}>
                <span className="inbox-item-top">
                  <strong>{m.direction === "out" ? `To ${m.to.join(", ")}` : m.sender}</strong>
                  <time>{when(m.at)}</time>
                </span>
                <span className="inbox-item-subject">{m.direction === "out" ? "↗ " : "↙ "}{m.subject || "(no subject)"}</span>
                <span className="inbox-item-bottom"><span className="inbox-item-preview">{m.body.replace(/\s+/g, " ").slice(0, 90)}</span><StatusChip message={m} /><AnalysisChip message={m} /></span>
              </button>
            </li>
          ))}
        </ul>
        <article className="inbox-reader" aria-live="polite">
          {open ? (
            <>
              <header>
                <h2>{open.subject || "(no subject)"}</h2>
                <dl>
                  <div><dt>From</dt><dd>{open.sender || "–"}</dd></div>
                  <div><dt>To</dt><dd>{open.to.join(", ")}</dd></div>
                  {open.cc.length > 0 && <div><dt>Cc</dt><dd>{open.cc.join(", ")}</dd></div>}
                  <div><dt>Date</dt><dd>{new Date(open.at).toLocaleString()}</dd></div>
                  {original && <div><dt>Reply to</dt><dd><button type="button" className="inbox-link" onClick={() => { setFolder("all"); setSelected(original.message_id); }}>{original.subject}</button></dd></div>}
                  {open.direction === "out" && <div><dt>Status</dt><dd>{open.status ? <><StatusChip message={open} />{open.status_at && <small> {new Date(open.status_at).toLocaleString()}</small>}</> : box?.status_source ? "No delivery event yet" : "Unknown (Brevo not configured)"}</dd></div>}
                </dl>
              </header>
              {open.direction === "in" && <AnalysisPanel message={open} onRetry={() => void load()} />}
              <div className="inbox-body">{open.body}</div>
            </>
          ) : <p className="inbox-empty">Select a message.</p>}
        </article>
      </div>
    </main>
  );
}
