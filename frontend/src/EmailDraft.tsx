import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Banner } from "@astryxdesign/core/Banner";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { XMarkIcon } from "@heroicons/react/24/outline";

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
    const draft = {
      to: addresses(value.to),
      cc: addresses(value.cc),
      subject: String(value.subject ?? ""),
      body: String(value.body ?? ""),
    };
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
  const draft = {
    to: [...new Set(recipients)],
    cc: cc ? [...new Set(cc[1].match(EMAIL) ?? [])] : [],
    subject: subject[1].replace(/\*\*/g, "").trim(),
    body,
  };
  return body ? { draft, before: text.slice(0, to.index).trim() } : null;
}

/** Split a message into Markdown text and email drafts; an unfinished block shows as drafting. */
export function splitDrafts(text: string): Segment[] {
  if (!text.includes("```email-draft")) {
    const loose = parseMarkdownDraft(text);
    if (loose) {
      return [
        ...(loose.before ? [{ kind: "text" as const, text: loose.before }] : []),
        { kind: "draft", draft: loose.draft },
      ];
    }
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

/** One header line of a mail window (To, Cc, Subject): a fixed label column, then the value. */
function mailLine(label: string, value: ReactNode, end?: ReactNode) {
  return (
    <>
      <HStack gap={3} vAlign="center" paddingBlock={2}>
        <VStack width={64}>
          <Text color="secondary">{label}</Text>
        </VStack>
        <StackItem size="fill">{value}</StackItem>
        {end}
      </HStack>
      <Divider />
    </>
  );
}

/** A header line's value: an input while editing, plain text once sent. */
function mailField(editable: boolean, label: string, value: string, set: (v: string) => void, weight?: "semibold") {
  return editable ? (
    <TextInput label={label} isLabelHidden value={value} onChange={set} />
  ) : (
    <Text weight={weight}>{value || "–"}</Text>
  );
}

/** A plain-text email body: paragraphs on blank lines, single line breaks kept. */
function MailBody({ text }: { text: string }) {
  return (
    <VStack gap={3}>
      {text.split(/\n\s*\n/).map((paragraph, index) => (
        <Text key={index} display="block" as="p">
          {paragraph.split("\n").map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </Text>
      ))}
    </VStack>
  );
}

/** Mail-program style preview of a draft; editable with a Send button while `onSend` is given. */
export function EmailDraftCard({
  draft,
  onSend,
  status,
  translation,
  approval,
  busy,
}: {
  draft: Draft;
  onSend?: (draft: Draft, approvedBy?: string) => void;
  status?: string;
  translation?: string;
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
  const line = mailLine;
  const field = (label: string, value: string, set: (v: string) => void, weight?: "semibold") =>
    mailField(editable, label, value, set, weight);

  return (
    <Card padding={4} elevation="low" width="100%">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <Text weight="semibold">{editable ? "New message" : "Email"}</Text>
          {status && <Badge label={status} variant="success" />}
        </HStack>
        <VStack gap={0}>
          {line(
            "To",
            field("To", editable ? to : draft.to.join(", "), setTo),
            editable && !showCc ? <Button label="Cc" variant="ghost" size="sm" onClick={() => setShowCc(true)} /> : undefined,
          )}
          {(showCc || (!editable && draft.cc.length > 0)) &&
            line("Cc", field("Cc", editable ? cc : draft.cc.join(", "), setCc))}
          {line("Subject", field("Subject", editable ? subject : draft.subject, setSubject, "semibold"))}
        </VStack>

        {editable ? (
          <TextArea
            label="Message"
            isLabelHidden
            value={body}
            onChange={setBody}
            rows={Math.min(24, Math.max(6, body.split("\n").length + 2))}
          />
        ) : (
          <MailBody text={draft.body} />
        )}

        {translation && (
          <Collapsible trigger={<Text weight="semibold">English translation</Text>} defaultIsOpen={false}>
            <Text color="secondary">{translation}</Text>
          </Collapsible>
        )}

        {editable && approval && (
          <VStack gap={2}>
            <Banner status="warning" title={`Approval needed: ${approval}`} />
            <HStack gap={2} vAlign="end" wrap="wrap">
              <CheckboxInput
                label="Approved by"
                value={approved}
                onChange={setApproved}
              />
              <StackItem size="fill">
                <TextInput
                  label="Approver name"
                  isLabelHidden
                  placeholder="Name of approver"
                  value={approvedBy}
                  onChange={setApprovedBy}
                />
              </StackItem>
            </HStack>
          </VStack>
        )}

        {editable && (
          <HStack gap={3} vAlign="center" hAlign="between">
            <Text type="supporting" color="secondary">
              Draft · sent only when you click Send
            </Text>
            <Button
              label={busy ? "Sending…" : "Send"}
              variant="primary"
              isLoading={busy}
              isDisabled={
                busy ||
                !edited.to.length ||
                !subject.trim() ||
                !body.trim() ||
                (!!approval && (!approved || !approvedBy.trim()))
              }
              onClick={() => onSend(edited, approval ? approvedBy.trim() : undefined)}
            />
          </HStack>
        )}
      </VStack>
    </Card>
  );
}

/** Full compose window used in the solution popup. */
export function ComposeWindow({
  context,
  title,
  draft,
  translation,
  approval,
  status,
  busy,
  error,
  onSend,
  onClose,
}: {
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
  const editable = !!onSend;
  const edited = { to: addresses(to), cc: addresses(cc), subject, body };
  const extraTranslation =
    translation?.trim() && !body.includes(translation.trim().slice(0, 80)) ? translation.trim() : "";
  const blocked =
    busy ||
    !edited.to.length ||
    !subject.trim() ||
    !body.trim() ||
    (!!approval && (!approved || !approvedBy.trim()));

  return (
    <VStack gap={0}>
      {/* One title bar: what the email solves, then the solution; close on the right */}
      <HStack gap={3} paddingInline={5} paddingBlock={4} vAlign="center">
        <StackItem size="fill">
          <VStack gap={0}>
            <Text type="supporting" color="secondary" maxLines={1}>
              {context}
            </Text>
            <Text weight="semibold">{title}</Text>
          </VStack>
        </StackItem>
        {status && <Badge label={status} variant="success" />}
        <IconButton
          label="Close"
          variant="ghost"
          icon={<Icon icon={XMarkIcon} size="sm" />}
          isDisabled={busy}
          onClick={onClose}
        />
      </HStack>
      <Divider />
      <VStack gap={4} paddingInline={5} paddingBlock={4}>
        <VStack gap={0}>
          {mailLine(
            "To",
            mailField(editable, "To", editable ? to : draft.to.join(", "), setTo),
            editable && !showCc ? <Button label="Cc" variant="ghost" size="sm" onClick={() => setShowCc(true)} /> : undefined,
          )}
          {(showCc || (!editable && draft.cc.length > 0)) &&
            mailLine("Cc", mailField(editable, "Cc", editable ? cc : draft.cc.join(", "), setCc))}
          {mailLine("Subject", mailField(editable, "Subject", editable ? subject : draft.subject, setSubject, "semibold"))}
        </VStack>
        {editable ? (
          <TextArea
            label="Message"
            isLabelHidden
            value={body}
            onChange={setBody}
            rows={Math.min(14, Math.max(6, body.split("\n").length + 2))}
          />
        ) : (
          <MailBody text={draft.body} />
        )}

        {extraTranslation && (
          <VStack gap={2}>
            <Button
              label={showTranslation ? "Hide English translation" : "Show English translation"}
              variant="ghost"
              size="sm"
              onClick={() => setShowTranslation((value) => !value)}
            />
            {showTranslation && <Text color="secondary">{extraTranslation}</Text>}
          </VStack>
        )}

        {editable && approval && (
          <VStack gap={2}>
            <Banner status="warning" title={`Requires approval: ${approval}`} />
            <HStack gap={2} vAlign="end" wrap="wrap">
              <CheckboxInput label="Approved by" value={approved} onChange={setApproved} />
              <StackItem size="fill">
                <TextInput
                  label="Approver name"
                  isLabelHidden
                  placeholder="Name"
                  value={approvedBy}
                  onChange={setApprovedBy}
                />
              </StackItem>
            </HStack>
          </VStack>
        )}

        {editable && (
          <HStack gap={3} vAlign="center">
            <Button
              label={busy ? "Sending…" : "Send"}
              variant="primary"
              isLoading={busy}
              isDisabled={blocked}
              onClick={() => onSend(edited, approval ? approvedBy.trim() : undefined)}
            />
            {error ? (
              <Text color="accent" role="alert">
                {error}
              </Text>
            ) : (
              <Text type="supporting" color="secondary">
                Nothing is sent until you click Send.
              </Text>
            )}
          </HStack>
        )}
      </VStack>
    </VStack>
  );
}
