import { useState } from "react";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Banner } from "@astryxdesign/core/Banner";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";

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
  const initial = (edited.to[0] ?? draft.to[0] ?? "?").slice(0, 1).toUpperCase();

  return (
    <Card padding={4} elevation="low">
      <VStack gap={3}>
        <HStack gap={3} vAlign="start">
          <Avatar name={initial} size="sm" />
          <StackItem size="fill">
            <VStack gap={2}>
              {editable ? (
                <TextInput label="Subject" value={subject} onChange={setSubject} placeholder="Subject" />
              ) : (
                <Heading level={4}>{draft.subject || "(no subject)"}</Heading>
              )}
              <HStack gap={2} vAlign="end" wrap="wrap">
                {editable ? (
                  <StackItem size="fill">
                    <TextInput label="To" value={to} onChange={setTo} />
                  </StackItem>
                ) : (
                  <HStack gap={1} wrap="wrap">
                    <Text type="supporting" color="secondary">
                      To
                    </Text>
                    {draft.to.map((address) => (
                      <Badge key={address} label={address} variant="neutral" />
                    ))}
                  </HStack>
                )}
                {editable && !showCc && (
                  <Button label="Cc" variant="ghost" size="sm" onClick={() => setShowCc(true)} />
                )}
              </HStack>
              {(showCc || (!editable && draft.cc.length > 0)) &&
                (editable ? (
                  <TextInput label="Cc" value={cc} onChange={setCc} />
                ) : (
                  <HStack gap={1} wrap="wrap">
                    <Text type="supporting" color="secondary">
                      Cc
                    </Text>
                    {draft.cc.map((address) => (
                      <Badge key={address} label={address} variant="neutral" />
                    ))}
                  </HStack>
                ))}
            </VStack>
          </StackItem>
          {status && <Badge label={status} variant="success" />}
        </HStack>

        {editable ? (
          <TextArea
            label="Message"
            value={body}
            onChange={setBody}
            rows={Math.min(16, Math.max(4, body.split("\n").length + 1))}
          />
        ) : (
          <Text display="block" as="p">
            {draft.body}
          </Text>
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
      <HStack gap={3} padding={4} vAlign="center" hAlign="between">
        <VStack gap={0}>
          <Text type="supporting" color="secondary">
            {context}
          </Text>
          <Text weight="semibold">{title}</Text>
        </VStack>
        <HStack gap={2} vAlign="center">
          {status && <Badge label={status} variant="success" />}
          <Button label="Close" variant="ghost" size="sm" isDisabled={busy} onClick={onClose} />
        </HStack>
      </HStack>
      <Divider />
      <VStack gap={3} padding={4}>
        {editable ? (
          <>
            <HStack gap={2} vAlign="end" wrap="wrap">
              <StackItem size="fill">
                <TextInput label="To" value={to} onChange={setTo} />
              </StackItem>
              {!showCc && <Button label="Cc" variant="ghost" size="sm" onClick={() => setShowCc(true)} />}
            </HStack>
            {showCc && <TextInput label="Cc" value={cc} onChange={setCc} />}
            <TextInput label="Subject" value={subject} onChange={setSubject} />
            <TextArea label="Message" value={body} onChange={setBody} rows={10} />
          </>
        ) : (
          <VStack gap={2}>
            <Text type="supporting" color="secondary">
              To · {draft.to.join(", ")}
            </Text>
            {draft.cc.length > 0 && (
              <Text type="supporting" color="secondary">
                Cc · {draft.cc.join(", ")}
              </Text>
            )}
            <Text weight="semibold">{draft.subject}</Text>
            <Text display="block" as="p">
              {draft.body}
            </Text>
          </VStack>
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
