import { useLayoutEffect, useRef, useState } from "react";

/** An email an agent proposes, as written in an `email-draft` code block. */
export interface Draft {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

/** Prefix of the chat message the Send button posts back to the agent. */
export const SEND_EMAIL_COMMAND = "SEND EMAIL:";

const BLOCK = /```email-draft[^\n]*\n([\s\S]*?)```/g;
const OPEN_BLOCK = /```email-draft[\s\S]*$/;

/** A piece of a chat message: Markdown text or a parsed email draft. */
export type Segment = { kind: "text"; text: string } | { kind: "draft"; draft: Draft } | { kind: "drafting" };

/** Normalize an address list that may arrive as a string or an array. */
function addresses(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : [];
  return items.map((item) => String(item).trim()).filter(Boolean);
}

/** Parse a draft block's JSON, or return null if it is not a usable draft. */
function parseDraft(json: string): Draft | null {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const draft = { to: addresses(value.to), cc: addresses(value.cc), subject: String(value.subject ?? ""), body: String(value.body ?? "") };
    return draft.to.length ? draft : null;
  } catch {
    return null;
  }
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const FIELD = (name: string) => new RegExp(`^[ \\t>*_-]*\\**${name}\\**\\s*:?\\**\\s*:?\\s*(.*)$`, "im");

/** Read a draft an agent wrote as plain Markdown ("To:", "Subject:", "Body"), or null. */
function parseMarkdownDraft(text: string): { draft: Draft; before: string } | null {
  const to = text.match(FIELD("To"));
  const subject = text.match(FIELD("Subject"));
  if (!to || !subject || (subject.index ?? 0) < (to.index ?? 0)) return null;
  const recipients = to[1].match(EMAIL);
  if (!recipients) return null;
  const cc = text.match(FIELD("Cc"));
  let body = text.slice((subject.index ?? 0) + subject[0].length);
  body = body.replace(/^\s*\**\s*Body\s*\**\s*:?\s*\**\s*\n/i, "");
  body = body.replace(/\n+\s*(?:Reply|Antworte)\b[^\n]*(?:send|confirm|senden|bestätig)[^\n]*\s*$/i, "");
  body = body.replace(/\*\*(.+?)\*\*/g, "$1").trim();
  const draft = { to: [...new Set(recipients)], cc: cc ? [...new Set(cc[1].match(EMAIL) ?? [])] : [], subject: subject[1].replace(/\*\*/g, "").trim(), body };
  return body ? { draft, before: text.slice(0, to.index).trim() } : null;
}

/** Split a message into Markdown text and email drafts; an unfinished block shows as drafting. */
export function splitDrafts(text: string): Segment[] {
  if (!text.includes("```email-draft")) {
    const loose = parseMarkdownDraft(text);
    if (loose) return [...(loose.before ? [{ kind: "text" as const, text: loose.before }] : []), { kind: "draft", draft: loose.draft }];
  }
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(BLOCK)) {
    const draft = parseDraft(match[1]);
    if (!draft) continue;
    segments.push({ kind: "text", text: text.slice(last, match.index) });
    segments.push({ kind: "draft", draft });
    last = (match.index ?? 0) + match[0].length;
  }
  const rest = text.slice(last);
  const open = rest.match(OPEN_BLOCK);
  if (open) {
    segments.push({ kind: "text", text: rest.slice(0, open.index) });
    segments.push({ kind: "drafting" });
  } else {
    segments.push({ kind: "text", text: rest });
  }
  return segments.filter((segment) => segment.kind !== "text" || segment.text.trim());
}

/** Build the chat message that tells the agent to send this exact draft. */
export function sendCommand(draft: Draft): string {
  return `${SEND_EMAIL_COMMAND}\n\`\`\`email-draft\n${JSON.stringify(draft, null, 2)}\n\`\`\``;
}

/** Read the draft out of a Send command, or null if the message is not one. */
export function parseSendCommand(text: string): Draft | null {
  if (!text.startsWith(SEND_EMAIL_COMMAND)) return null;
  const segment = splitDrafts(text).find((item) => item.kind === "draft");
  return segment?.kind === "draft" ? segment.draft : null;
}

/** Whether two drafts are the same email. */
export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Mail-program style preview of a draft; editable with a Send button while `onSend` is given.
 *
 * @param draft - The proposed email.
 * @param onSend - Called with the (possibly edited) draft; omit for a read-only preview.
 * @param status - Label shown instead of the actions, e.g. "Sent to agent".
 */
export function EmailDraftCard({ draft, onSend, status, translation, approval, busy }: {
  draft: Draft;
  onSend?: (draft: Draft, approvedBy?: string) => void;
  status?: string;
  /** English translation of the body, shown for review. */
  translation?: string;
  /** Who must approve (PP-07); Send stays disabled until someone confirms. */
  approval?: string;
  busy?: boolean;
}) {
  const [approvedBy, setApprovedBy] = useState("");
  const [approved, setApproved] = useState(false);
  const [to, setTo] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const editable = !!onSend;
  const edited = { to: addresses(to), cc: addresses(cc), subject, body };
  const initial = (edited.to[0] ?? draft.to[0] ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className={`mail${editable ? " mail-editable" : ""}`} role="group" aria-label={`Email: ${subject || draft.subject}`}>
      <div className="mail-head">
        <span className="mail-avatar" aria-hidden="true">{initial}</span>
        <div className="mail-meta">
          {editable
            ? <input className="mail-subject" aria-label="Subject" placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            : <h4 className="mail-subject">{draft.subject || "(no subject)"}</h4>}
          <div className="mail-line">
            <span className="mail-label">To</span>
            {editable
              ? <input aria-label="To" value={to} onChange={(event) => setTo(event.target.value)} />
              : <span className="mail-chips">{draft.to.map((address) => <span key={address} className="mail-chip">{address}</span>)}</span>}
            {editable && !showCc && <button type="button" className="mail-cc-toggle" onClick={() => setShowCc(true)}>Cc</button>}
          </div>
          {(showCc || (!editable && draft.cc.length > 0)) && (
            <div className="mail-line">
              <span className="mail-label">Cc</span>
              {editable
                ? <input aria-label="Cc" value={cc} onChange={(event) => setCc(event.target.value)} />
                : <span className="mail-chips">{draft.cc.map((address) => <span key={address} className="mail-chip">{address}</span>)}</span>}
            </div>
          )}
        </div>
        {status && <span className="mail-status">{status}</span>}
      </div>
      {editable
        ? <textarea className="mail-body" aria-label="Message" rows={Math.min(16, Math.max(4, body.split("\n").length + 1))} value={body} onChange={(event) => setBody(event.target.value)} />
        : <div className="mail-body">{draft.body}</div>}
      {translation && <details className="mail-translation"><summary>English translation</summary><p>{translation}</p></details>}
      {editable && approval && (
        <div className="mail-approval">
          <p><strong>Approval needed:</strong> {approval}</p>
          <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> Approved by</label>
          <input aria-label="Approver name" placeholder="Name of approver" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} />
        </div>
      )}
      {editable && (
        <div className="mail-foot">
          <span className="mail-hint">Draft · sent only when you click Send</span>
          <button type="button" className="mail-send" disabled={busy || !edited.to.length || !subject.trim() || !body.trim() || (!!approval && (!approved || !approvedBy.trim()))} onClick={() => onSend(edited, approval ? approvedBy.trim() : undefined)}>
            {busy ? "Sending…" : "Send"}
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 12 20 4l-6.5 16-2.5-6.5L4 12Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
/** Full compose window (used in the solution popup): fields, growing body, approval and Send.
 *
 * @param context - What the email is about, e.g. the notification title.
 * @param title - The solution's title, shown in the window bar.
 * @param onSend - Called with the edited draft and approver; omit for a read-only sent view.
 * @param approval - Who must approve (PP-07); Send stays disabled until confirmed.
 */
export function ComposeWindow({ context, title, draft, translation, approval, status, busy, error, onSend, onClose }: {
  context: string;
  title: string;
  draft: Draft;
  translation?: string;
  approval?: string;
  status?: string;
  busy?: boolean;
  error?: string;
  onSend?: (draft: Draft, approvedBy?: string) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [approvedBy, setApprovedBy] = useState("");
  const [approved, setApproved] = useState(false);
  const bodyBox = useRef<HTMLTextAreaElement>(null);
  const editable = !!onSend;
  const edited = { to: addresses(to), cc: addresses(cc), subject, body };
  // The body usually already holds the English version; only offer a translation that adds something.
  const extraTranslation = translation?.trim() && !body.includes(translation.trim().slice(0, 80)) ? translation.trim() : "";
  const blocked = busy || !edited.to.length || !subject.trim() || !body.trim() || (!!approval && (!approved || !approvedBy.trim()));

  useLayoutEffect(() => {
    const box = bodyBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [body]);

  const field = (label: string, value: string, set: (value: string) => void, readOnly: string) => (
    <label className="compose-field"><span>{label}</span>{editable ? <input value={value} onChange={(event) => set(event.target.value)} /> : <em>{readOnly}</em>}</label>
  );

  return (
    <div className="compose">
      <header className="compose-bar">
        <div><small>{context}</small><strong>{title}</strong></div>
        {status && <span className="compose-status">{status}</span>}
        <button type="button" className="compose-close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
      </header>
      <div className="compose-fields">
        <div className="compose-row">
          {field("To", to, setTo, draft.to.join(", "))}
          {editable && !showCc && <button type="button" className="compose-cc" onClick={() => setShowCc(true)}>Cc</button>}
        </div>
        {(showCc || (!editable && draft.cc.length > 0)) && <div className="compose-row">{field("Cc", cc, setCc, draft.cc.join(", "))}</div>}
        <div className="compose-row compose-subject">{field("Subject", subject, setSubject, draft.subject)}</div>
      </div>
      <div className="compose-scroll">
        {editable
          ? <textarea ref={bodyBox} className="compose-body" aria-label="Message" value={body} onChange={(event) => setBody(event.target.value)} />
          : <div className="compose-body">{draft.body}</div>}
        {extraTranslation && (
          <div className="compose-translation">
            <button type="button" onClick={() => setShowTranslation((value) => !value)}>{showTranslation ? "Hide" : "Show"} English translation</button>
            {showTranslation && <p>{extraTranslation}</p>}
          </div>
        )}
      </div>
      {editable && approval && (
        <div className="compose-approval">
          <span>Requires approval: <strong>{approval}</strong></span>
          <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> Approved by</label>
          <input aria-label="Approver name" placeholder="Name" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} />
        </div>
      )}
      {editable && (
        <footer className="compose-foot">
          <button type="button" className="compose-send" disabled={blocked} onClick={() => onSend(edited, approval ? approvedBy.trim() : undefined)}>{busy ? "Sending…" : "Send"}</button>
          {error ? <span className="compose-error" role="alert">{error}</span> : <span className="compose-hint">Nothing is sent until you click Send.</span>}
        </footer>
      )}
    </div>
  );
}