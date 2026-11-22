import { useEffect, useMemo, useState } from "react";
import { getMailbox } from "./api";
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

  useEffect(() => {
    const load = () => getMailbox().then((value) => { setBox(value); setError(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the inbox."));
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const messages = useMemo(() => (box?.messages ?? []).filter((m) => folder === "all" || m.direction === folder), [box, folder]);
  const open = messages.find((m) => m.message_id === selected) ?? messages[0];

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
      </header>
      {error && <p className="message message-error" role="alert">{error}</p>}
      {box && !box.incoming_configured && folder !== "out" && <p className="inbox-notice">Received mail is not connected yet. Supplier replies go to {box.sender ?? "the sender address"} and will appear here once incoming mail is set up.</p>}
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
                <span className="inbox-item-bottom"><span className="inbox-item-preview">{m.body.replace(/\s+/g, " ").slice(0, 90)}</span><StatusChip message={m} /></span>
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
                  {open.direction === "out" && <div><dt>Status</dt><dd>{open.status ? <><StatusChip message={open} />{open.status_at && <small> {new Date(open.status_at).toLocaleString()}</small>}</> : box?.status_source ? "No delivery event yet" : "Unknown (Brevo not configured)"}</dd></div>}
                </dl>
              </header>
              <div className="inbox-body">{open.body}</div>
            </>
          ) : <p className="inbox-empty">Select a message.</p>}
        </article>
      </div>
    </main>
  );
}
