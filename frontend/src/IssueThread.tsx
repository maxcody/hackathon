import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ArrowUturnLeftIcon, ExclamationCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { Divider } from "@astryxdesign/core/Divider";
import { Spinner } from "@astryxdesign/core/Spinner";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Badge } from "@astryxdesign/core/Badge";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Card } from "@astryxdesign/core/Card";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { draftEmail, getThread, reanalyzeEmail, sendFollowUp, sendSolutionEmail } from "./api";
import type { MailMessage, Notification, Source, ThreadSummary } from "./types";
import { MailBody, addresses, mailField, mailLine } from "./EmailDraft";
import { STATUS_LABEL, STATUS_VARIANT, when } from "./InboxPage";

const SIGNATURE = "Kind regards,\nSoony Launch Control\nSoony Interactive GmbH";
const OUTCOME: Record<string, { label: string; variant: "success" | "warning" | "error" | "info" }> = {
  confirmed: { label: "Confirmed", variant: "success" },
  partial: { label: "Partly", variant: "warning" },
  declined: { label: "Declined", variant: "error" },
  question: { label: "Asks a question", variant: "info" },
};

/** One-click change requests for the agent, under the draft. */
const REFINEMENTS = ["Shorter", "Firmer on the deadline", "More polite", "Ask for tracking details"];

/** The bare, lower-case address in "Name <a@b.c>". */
export function addressOf(value: string): string {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
}

/** A first name guessed from an address like "rohan.d.pune-diecast@…" ("Rohan"). */
function nameOf(address: string): string {
  const first = addressOf(address).split("@")[0].split(/[._-]/)[0];
  return first.length > 1 ? first[0].toUpperCase() + first.slice(1) : "";
}

/** The other party of a message: the supplier address. */
function counterpart(m: MailMessage): string {
  return m.direction === "out" ? addressOf(m.to[0] ?? "") : addressOf(m.sender);
}

/** Status line of a thread for an issue card: who has to act next. */
export function threadState(summary: ThreadSummary | undefined): { label: string; variant: "info" | "neutral" } | null {
  if (!summary) return null;
  return summary.last_direction === "in"
    ? { label: `Supplier replied ${when(summary.last_at)}`, variant: "info" }
    : { label: `Awaiting reply since ${when(summary.last_at)}`, variant: "neutral" };
}

/**
 * What the agent made of a received email, compact: outcome, summary and the next step
 * with a button that drafts that reply; findings and risk fold into Details.
 */
function AgentNote({ message, onRetry, onDraftReply }: { message: MailMessage; onRetry: () => void; onDraftReply: (brief: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const analysis = message.analysis;
  async function retry() {
    setBusy(true);
    try {
      await reanalyzeEmail(message.message_id);
      onRetry();
    } finally {
      setBusy(false);
    }
  }
  if (!analysis || analysis.status === "running") {
    return (
      <HStack gap={2} vAlign="center">
        <Spinner size="sm" aria-label="The agent is reading this email" />
        <Text type="supporting"><span className="thinking">The agent is reading this email…</span></Text>
      </HStack>
    );
  }
  if (analysis.status === "failed") {
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={ExclamationCircleIcon} size="sm" color="error" />
        <Text type="supporting" color="secondary">The agent could not analyze this email.</Text>
        <Button label={busy ? "Restarting…" : "Analyze again"} variant="ghost" size="sm" isLoading={busy} onClick={() => void retry()} />
      </HStack>
    );
  }
  const outcome = analysis.outcome ? OUTCOME[analysis.outcome] : undefined;
  const hasDetails = analysis.commitments.length > 0 || !!analysis.risks || !!analysis.translation;
  return (
    <Card padding={3} variant="muted">
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Icon icon={SparklesIcon} size="sm" color="accent" />
          <Text type="supporting" weight="semibold">Agent</Text>
          {outcome && <Badge label={outcome.label} variant={outcome.variant} />}
          <StackItem size="fill" />
          {hasDetails && <Button label={open ? "Hide details" : "Details"} variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} />}
        </HStack>
        <Text>{analysis.summary}</Text>
        {analysis.next_step && (
          <HStack gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <Text type="supporting" color="secondary">Next step: {analysis.next_step}</Text>
            </StackItem>
            <Button label="Draft this reply" variant="primary" size="sm" icon={<Icon icon={SparklesIcon} size="sm" />} onClick={() => onDraftReply(analysis.next_step)} />
          </HStack>
        )}
        {open && (
          <VStack gap={2}>
            {analysis.commitments.map((c, index) => (
              <Text key={index} type="supporting">
                • {c.what}
                {[c.quantity, c.date, c.price].filter(Boolean).length > 0 && (
                  <Text type="supporting" color="secondary"> ({[c.quantity, c.date, c.price].filter(Boolean).join(" · ")})</Text>
                )}
              </Text>
            ))}
            {analysis.risks && <Text type="supporting"><Text type="supporting" weight="semibold">Risk: </Text>{analysis.risks}</Text>}
            {analysis.translation && <Text type="supporting" color="secondary">{analysis.translation}</Text>}
            <HStack>
              <Button label={busy ? "Restarting…" : "Analyze again"} variant="ghost" size="sm" isLoading={busy} onClick={() => void retry()} />
            </HStack>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}

/** One email in the conversation, like a mail client; older ones start folded to their first line. */
function ThreadMessage({ message, folded, onUnfold, onAnalysis, onDraftReply }: { message: MailMessage; folded: boolean; onUnfold: () => void; onAnalysis: () => void; onDraftReply: (brief: string) => void }) {
  const ours = message.direction === "out";
  const who = ours ? "Soony Launch Control" : message.sender.replace(/<[^>]+>/, "").trim() || message.sender;
  return (
    <Card padding={4} variant={ours ? "muted" : "default"}>
      <VStack gap={3}>
        <HStack gap={3} vAlign="center">
          <Avatar name={who} size="sm" />
          <StackItem size="fill">
            <HStack gap={2} vAlign="center">
              <Text weight="semibold" maxLines={1}>{who}</Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {ours ? `to ${message.to.join(", ")}` : addressOf(message.sender)}
              </Text>
            </HStack>
          </StackItem>
          {ours && message.status && <Badge label={STATUS_LABEL[message.status] ?? message.status} variant={STATUS_VARIANT[message.status] ?? "error"} />}
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {new Date(message.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </Text>
        </HStack>
        {folded ? (
          <Button label={message.body.replace(/\s+/g, " ").slice(0, 140) + "…"} variant="ghost" size="sm" onClick={onUnfold} />
        ) : (
          <>
            {/* Read the agent's take first, then the email itself */}
            {!ours && <AgentNote message={message} onRetry={onAnalysis} onDraftReply={onDraftReply} />}
            <MailBody text={message.body} />
          </>
        )}
      </VStack>
    </Card>
  );
}

/**
 * The emails of one issue, oldest first, per supplier, with a composer for
 * replies, follow-ups and requests to other suppliers.
 *
 * @param writeTo - Address picked elsewhere (e.g. the supplier panel) to write to next.
 */
export function IssueConversation({
  notification,
  sources,
  writeTo,
  onSent,
}: {
  notification: Notification;
  sources: Source[];
  writeTo: { address: string; nonce: number } | null;
  onSent: () => void;
}) {
  const [thread, setThread] = useState<MailMessage[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [party, setParty] = useState("all");
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [approved, setApproved] = useState(false);
  const [approvedBy, setApprovedBy] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentNote, setSentNote] = useState("");
  // AI drafting: what the agent is doing, the user's change request, and the version before it
  const [drafting, setDrafting] = useState<"new" | "refine" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [previous, setPrevious] = useState<{ subject: string; body: string } | null>(null);
  const [draftError, setDraftError] = useState("");
  // Index of the proposed solution loaded into the composer: sent as that solution (approval, status)
  const [proposal, setProposal] = useState<number | null>(null);
  const [showCc, setShowCc] = useState(false);

  const sourceByAddress = useMemo(() => new Map(sources.map((s) => [s.contact_email.toLowerCase(), s])), [sources]);
  const label = useCallback((address: string) => sourceByAddress.get(address)?.name ?? address, [sourceByAddress]);

  /** Prefill the composer for `address`, or as a reply to the latest supplier mail. */
  const prepare = useCallback(
    (messages: MailMessage[], address?: string) => {
      const lastIn = [...messages].reverse().find((m) => m.direction === "in");
      const lastOut = [...messages].reverse().find((m) => m.direction === "out");
      const proposed = (notification.data.solutions ?? []).find((s) => s.email)?.email;
      const target = address ?? (lastIn ? addressOf(lastIn.sender) : lastOut?.to[0] ?? proposed?.to[0] ?? "");
      const own = messages.filter((m) => counterpart(m) === addressOf(target));
      const base = (own[0]?.subject ?? proposed?.subject ?? notification.data.title ?? "").replace(/^(re|aw|sv):\s*/i, "");
      const name = target ? nameOf(target) : "";
      setTo(target);
      setCc("");
      setSubject(own.length ? `Re: ${base}` : base);
      setBody(`${name ? `Dear ${name},` : "Hello,"}\n\n\n\n${SIGNATURE}`);
      setApproved(false);
      setApprovedBy("");
      setProposal(null);
      setPrevious(null);
      setShowCc(false);
    },
    [notification],
  );

  const load = useCallback(
    async (refresh = false, reset = false) => {
      setLoading(true);
      try {
        const messages = await getThread(notification.id, refresh);
        setThread(messages);
        setError("");
        // Start with the supplier picked in the side panel, else reply to the latest mail
        if (reset) prepare(messages, writeTo?.address);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load the conversation.");
      } finally {
        setLoading(false);
      }
    },
    [notification.id, prepare, writeTo],
  );

  useEffect(() => {
    void load(false, true);
  }, [load]);

  const messages = thread ?? [];
  const parties = [...new Set(messages.map(counterpart))];
  const shown = party === "all" ? messages : messages.filter((m) => counterpart(m) === party);
  const target = sourceByAddress.get(addressOf(addresses(to)[0] ?? ""));
  const newSupplier = !!to && !messages.some((m) => counterpart(m) === addressOf(to));
  const solutions = notification.data.solutions ?? [];
  const proposed = solutions.map((s, index) => ({ s, index })).filter(({ s }) => s.email && s.status !== "sent");
  const loaded = proposal !== null ? solutions[proposal] : undefined;
  // A proposed solution keeps its own approval rule; otherwise PP-07 applies to new conditional suppliers
  const approvalText = loaded?.approval
    ? `Requires approval: ${loaded.approval}`
    : target?.needs_approval && newSupplier
      ? `${target.name} is ${target.role === "same_category" ? "not qualified for this part" : "a conditional supplier"}: ordering needs approval under PP-07${target.role === "same_category" ? " and a sample" : ""}.`
      : "";
  const needsApproval = !!approvalText;
  const written = body.replace(SIGNATURE, "").split("\n").slice(1).join("\n").trim();
  const canSend =
    !sending && !drafting && addresses(to).length > 0 && subject.trim() && written && (!needsApproval || (approved && approvedBy.trim()));

  /** Load a proposed solution email into the composer. */
  function useProposal(index: number) {
    const email = solutions[index]?.email;
    if (!email) return;
    setTo(email.to.join(", "));
    setCc((email.cc ?? []).join(", "));
    setSubject(email.subject);
    setBody(email.body);
    setProposal(index);
    setPrevious(null);
    setShowCc((email.cc ?? []).length > 0);
    setApproved(false);
    setApprovedBy("");
  }

  /**
   * Ask the agent for a draft. With `change`, it rewrites the current draft; with `brief`
   * (e.g. the analysis' next step), it writes a fresh one that does that, to `recipient`.
   */
  async function draft({ change, brief, recipient }: { change?: string; brief?: string; recipient?: string } = {}) {
    const address = recipient ?? addressOf(addresses(to)[0] ?? to);
    setDrafting(change ? "refine" : "new");
    setDraftError("");
    try {
      const result = await draftEmail(notification.id, {
        to: address,
        subject,
        body: change ? body : "",
        feedback: change ?? brief ?? "",
      });
      setPrevious({ subject, body });
      setSubject(result.subject);
      setBody(result.body);
      if (change) setFeedback("");
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : "The agent could not write a draft.");
    } finally {
      setDrafting(null);
    }
  }

  /** "Draft this reply" on a received email: address its sender and write what the agent suggests. */
  function draftReply(message: MailMessage, brief: string) {
    if (thread) prepare(thread, addressOf(message.sender));
    document.getElementById("composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
    void draft({ brief, recipient: addressOf(message.sender) });
  }

  function undo() {
    if (!previous) return;
    setSubject(previous.subject);
    setBody(previous.body);
    setPrevious(null);
  }

  async function send() {
    setSending(true);
    setSendError("");
    setSentNote("");
    const email = {
      to: addresses(to),
      cc: addresses(cc),
      subject,
      body,
      ...(needsApproval ? { approved_by: approvedBy.trim() } : {}),
    };
    try {
      let updated: MailMessage[];
      if (proposal !== null) {
        // Sent as the proposed solution, so the issue records it as sent
        await sendSolutionEmail(notification.id, proposal, email);
        updated = await getThread(notification.id);
      } else {
        updated = await sendFollowUp(notification.id, email);
      }
      setThread(updated);
      prepare(updated);
      setSentNote(`Sent to ${email.to.join(", ")}.`);
      onSent();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "The email was not sent.");
    } finally {
      setSending(false);
    }
  }

  // Composer "To" choices: everyone in the thread, then the part's suppliers
  const choices = [...new Set([...parties, ...sources.map((s) => s.contact_email.toLowerCase())])].filter(Boolean);

  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        {parties.length > 1 ? (
          <SegmentedControl label="Show emails with" value={party} onChange={setParty}>
            <SegmentedControlItem value="all" label={`All (${messages.length})`} />
            {parties.map((address) => (
              <SegmentedControlItem key={address} value={address} label={label(address)} />
            ))}
          </SegmentedControl>
        ) : (
          <Text type="supporting" color="secondary">
            {messages.length} {messages.length === 1 ? "email" : "emails"}
            {parties[0] ? ` with ${label(parties[0])}` : ""}
          </Text>
        )}
        <StackItem size="fill" />
        <Button label={loading ? "Checking…" : "Check for new emails"} variant="ghost" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} isDisabled={loading} onClick={() => void load(true)} />
      </HStack>

      {error && <Banner status="error" title={error} />}
      {thread === null && !error ? (
        <EmptyState title="Loading the conversation…" isCompact />
      ) : shown.length === 0 ? (
        <EmptyState
          title="No emails for this issue yet"
          description="Send a proposed solution email, or write to a supplier below. Their answers appear here."
          isCompact
        />
      ) : (
        <VStack gap={3}>
          {shown.map((m, index) => (
            <ThreadMessage
              key={`${m.direction}:${m.message_id}`}
              message={m}
              folded={index < shown.length - 2 && !unfolded.has(m.message_id)}
              onUnfold={() => setUnfolded((set) => new Set(set).add(m.message_id))}
              onAnalysis={() => void load(true)}
              onDraftReply={(brief) => draftReply(m, brief)}
            />
          ))}
        </VStack>
      )}

      {proposed.length > 0 && (
        <Card padding={4} variant="muted">
          <VStack gap={3}>
            <Text weight="semibold">Proposed drafts</Text>
            {proposed.map(({ s, index }) => (
              <HStack key={index} gap={3} vAlign="center">
                <StackItem size="fill">
                  <VStack gap={0}>
                    <Text weight="medium" maxLines={1}>{s.title}</Text>
                    <Text type="supporting" color="secondary" maxLines={1}>
                      To {s.email?.to.map(label).join(", ")} · {s.email?.subject}
                    </Text>
                  </VStack>
                </StackItem>
                {proposal === index ? (
                  <Text type="supporting" color="secondary">In the composer</Text>
                ) : (
                  <Button label="Open draft" variant="secondary" size="sm" onClick={() => useProposal(index)} />
                )}
              </HStack>
            ))}
          </VStack>
        </Card>
      )}

      <Card id="composer" padding={0} elevation="low">
        <VStack gap={0}>
          {/* Title bar: what this email is and who it goes to, plus the agent */}
          <HStack gap={2} vAlign="center" paddingInline={4} paddingBlock={2}>
            <Text weight="semibold" maxLines={1}>
              {loaded ? loaded.title : newSupplier ? "New request to" : messages.at(-1)?.direction === "in" ? "Reply to" : "Follow up with"}
            </Text>
            {!loaded && choices.length > 0 && (
              <Selector
                label="Recipient"
                isLabelHidden
                variant="ghost"
                size="sm"
                value={choices.includes(addressOf(to)) ? addressOf(to) : ""}
                onChange={(address) => thread && prepare(thread, address)}
                options={choices.map((address) => {
                  const s = sourceByAddress.get(address);
                  const role = s ? (s.role === "primary" ? "primary" : s.role === "second_source" ? "second source" : "not qualified") : "in this thread";
                  return { value: address, label: `${label(address)} · ${role}` };
                })}
              />
            )}
            <StackItem size="fill" />
            <Button
              label={drafting === "new" ? "Writing…" : "Draft with AI"}
              variant="secondary"
              size="sm"
              icon={<Icon icon={SparklesIcon} size="sm" />}
              isLoading={drafting === "new"}
              isDisabled={!!drafting || !addresses(to).length}
              onClick={() => void draft()}
            />
          </HStack>
          <Divider />
          <VStack gap={0} paddingInline={4}>
            {mailLine("To", mailField(true, "To", to, setTo), showCc ? undefined : <Button label="Cc" variant="ghost" size="sm" onClick={() => setShowCc(true)} />)}
            {showCc && mailLine("Cc", mailField(true, "Cc", cc, setCc))}
            {mailLine("Subject", mailField(true, "Subject", subject, setSubject, "semibold"))}
          </VStack>
          <VStack gap={2} padding={4}>
            <TextArea
              label="Message"
              isLabelHidden
              value={body}
              onChange={setBody}
              isDisabled={!!drafting}
              rows={Math.min(16, Math.max(6, body.split("\n").length + 1))}
            />
            {/* One line to ask the agent for changes; quick changes underneath */}
            {drafting ? (
              <HStack gap={2} vAlign="center">
                <Spinner size="sm" aria-label="The agent is writing" />
                <Text type="supporting">
                  <span className="thinking">The agent is {drafting === "new" ? "writing a draft" : "revising the draft"}…</span>
                </Text>
              </HStack>
            ) : (
              <>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <TextInput
                      label="Ask AI to change this draft"
                      isLabelHidden
                      size="sm"
                      startIcon={SparklesIcon}
                      placeholder="Ask AI to change this draft, e.g. shorter or firmer on the deadline"
                      value={feedback}
                      onChange={setFeedback}
                    />
                  </StackItem>
                  <Button label="Refine" variant="secondary" size="sm" isDisabled={!feedback.trim() || !written} onClick={() => void draft({ change: feedback.trim() })} />
                </HStack>
                {written && (
                  <HStack gap={1} wrap="wrap">
                    {REFINEMENTS.map((change) => (
                      <Button key={change} label={change} variant="ghost" size="sm" onClick={() => void draft({ change })} />
                    ))}
                  </HStack>
                )}
              </>
            )}
            {draftError && <Text type="supporting" color="accent" role="alert">{draftError}</Text>}
            {needsApproval && (
              <VStack gap={2}>
                <Banner status="warning" title={approvalText} />
                <HStack gap={2} vAlign="end" wrap="wrap">
                  <CheckboxInput label="Approved by" value={approved} onChange={setApproved} />
                  <StackItem size="fill">
                    <TextInput label="Approver name" isLabelHidden size="sm" placeholder="Name" value={approvedBy} onChange={setApprovedBy} />
                  </StackItem>
                </HStack>
              </VStack>
            )}
          </VStack>
          <Divider />
          <HStack gap={3} vAlign="center" paddingInline={4} paddingBlock={2}>
            <Button label={sending ? "Sending…" : "Send"} variant="primary" size="sm" isLoading={sending} isDisabled={!canSend} onClick={() => void send()} />
            {previous && !drafting && <Button label="Undo AI change" variant="ghost" size="sm" icon={<Icon icon={ArrowUturnLeftIcon} size="sm" />} onClick={undo} />}
            <StackItem size="fill" />
            {sendError ? (
              <Text type="supporting" color="accent" role="alert">{sendError}</Text>
            ) : (
              <Text type="supporting" color="secondary">{sentNote || "Nothing is sent until you click Send."}</Text>
            )}
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}
