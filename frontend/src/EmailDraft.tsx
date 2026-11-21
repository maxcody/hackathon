import { useState } from "react";

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
export function EmailDraftCard({ draft, onSend, status }: { draft: Draft; onSend?: (draft: Draft) => void; status?: string }) {
  const [to, setTo] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const editable = !!onSend;
  const edited = { to: addresses(to), cc: addresses(cc), subject, body };

  return (
    <div className="mail-draft" role="group" aria-label={`Email draft: ${draft.subject}`}>
      <div className="mail-draft-bar"><span className="mail-draft-icon" aria-hidden="true">✉</span><strong>{editable ? "New message" : "Email"}</strong>{status && <span className="mail-draft-status">{status}</span>}</div>
      <label className="mail-draft-field"><span>To</span>{editable ? <input value={to} onChange={(event) => setTo(event.target.value)} /> : <em>{draft.to.join(", ")}</em>}</label>
      {(editable || draft.cc.length > 0) && <label className="mail-draft-field"><span>Cc</span>{editable ? <input value={cc} onChange={(event) => setCc(event.target.value)} /> : <em>{draft.cc.join(", ")}</em>}</label>}
      <label className="mail-draft-field"><span>Subject</span>{editable ? <input value={subject} onChange={(event) => setSubject(event.target.value)} /> : <em>{draft.subject}</em>}</label>
      {editable
        ? <textarea className="mail-draft-body" aria-label="Message" rows={Math.min(14, Math.max(4, body.split("\n").length + 1))} value={body} onChange={(event) => setBody(event.target.value)} />
        : <div className="mail-draft-body">{draft.body}</div>}
      {editable && (
        <div className="mail-draft-actions">
          <small>Only sent when you click Send.</small>
          <button type="button" className="button button-dark" disabled={!edited.to.length || !subject.trim()} onClick={() => onSend(edited)}>Send ➤</button>
        </div>
      )}
    </div>
  );
}
