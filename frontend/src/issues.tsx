import { useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { List, ListItem } from "@astryxdesign/core/List";
import { Dialog } from "@astryxdesign/core/Dialog";
import { sendSolutionEmail } from "./api";
import type { Notification, Severity, Solution, SupplierState } from "./types";
import { ComposeWindow } from "./EmailDraft";
import type { Draft } from "./EmailDraft";

export const severityOrder: Severity[] = ["critical", "warning", "info"];

/** Normalize a notification's free-text severity to a known level. */
export function severityOf(notification: Notification): Severity {
  const value = String(notification.data.severity ?? "").toLowerCase();
  return (severityOrder as string[]).includes(value) ? (value as Severity) : "info";
}

/** Whether a notification still needs a person. */
export function isOpen(notification: Notification): boolean {
  return (notification.data.status ?? "open") !== "resolved";
}

/** Badge color of a severity. */
export function severityVariant(severity: Severity): "error" | "warning" | "info" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

/** Status dot color of a severity. */
export function severityDot(severity: Severity): "error" | "warning" | "accent" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warning";
  return "accent";
}

/** Issues in the order the list shows them: open first, by severity, newest first. */
export function sortIssues(notifications: Notification[]): Notification[] {
  return [...notifications].sort(
    (a, b) =>
      Number(isOpen(b)) - Number(isOpen(a)) ||
      severityOrder.indexOf(severityOf(a)) - severityOrder.indexOf(severityOf(b)) ||
      b.seen_at.localeCompare(a.seen_at),
  );
}

/**
 * Open issues in the order to work on them: by severity; within a severity,
 * issues where a supplier answered (someone must reply) come first, then
 * issues with a proposed action still to take, then the newest.
 */
export function byPriority(notifications: Notification[], threads: Record<string, { last_direction: string }>): Notification[] {
  const weight = (n: Notification) =>
    severityOrder.indexOf(severityOf(n)) * 10 +
    (threads[n.id]?.last_direction === "in" ? 0 : openSolutions(n).length ? 1 : 2);
  return notifications
    .filter(isOpen)
    .sort((a, b) => weight(a) - weight(b) || b.seen_at.localeCompare(a.seen_at));
}

/** The part an issue is about (e.g. CMP-GAM-001), from its key, title or sources. */
export function componentOf(n: Notification): string | null {
  const text = [n.data.key, n.data.title, n.attr, n.data.details, ...(n.data.refs ?? [])].join(" ");
  return text.match(/CMP-[A-Z]+-\d+/i)?.[0].toUpperCase() ?? null;
}

/** Display title of an issue. */
export function issueTitle(n: Notification): string {
  return n.data.title || `${n.attr.replace(/_/g, " ")} mismatch`;
}

const SUPPLIER_STATE: Record<SupplierState["state"], { label: string; variant: "neutral" | "success" | "warning" | "error" }> = {
  asked: { label: "waiting", variant: "neutral" },
  confirmed: { label: "confirmed", variant: "success" },
  partial: { label: "partly", variant: "warning" },
  declined: { label: "declined", variant: "error" },
  no_answer: { label: "no answer", variant: "warning" },
};

/** "Hwaseong · declined → Boise Semi · waiting": the suppliers asked, in order. */
export function SupplierChain({ suppliers }: { suppliers: SupplierState[] }) {
  if (!suppliers.length) return null;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {suppliers.map((s, index) => (
        <HStack key={s.supplier_id} gap={2} vAlign="center">
          {index > 0 && <Text color="secondary" aria-hidden>→</Text>}
          <Text weight="semibold">{s.name}</Text>
          <Badge label={SUPPLIER_STATE[s.state]?.label ?? s.state} variant={SUPPLIER_STATE[s.state]?.variant ?? "neutral"} />
        </HStack>
      ))}
    </HStack>
  );
}

/** Label and color of one supplier state. */
export function supplierState(state: SupplierState["state"]) {
  return SUPPLIER_STATE[state] ?? { label: state, variant: "neutral" as const };
}

const SOLUTION_KIND: Record<Solution["kind"], string> = {
  email: "Email",
  claim: "Claim",
  internal: "Internal",
  decision: "Decision",
};

/** Solutions that still need doing (not sent), for "next step" summaries. */
export function openSolutions(n: Notification): Solution[] {
  return (n.data.solutions ?? []).filter((s) => s.status !== "sent" && s.stage !== "if_declined");
}

/**
 * Proposed solutions, grouped: what to do now (backups asked in parallel are
 * marked), then plan B for when a supplier cannot deliver.
 */
export function SolutionList({ notification, onChanged }: { notification: Notification; onChanged: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const solutions = (notification.data.solutions ?? []).map((solution, index) => ({ solution, index }));
  const now = solutions.filter(({ solution }) => solution.stage !== "if_declined");
  const planB = solutions.filter(({ solution }) => solution.stage === "if_declined");

  const item = ({ solution, index }: { solution: Solution; index: number }) => (
    <ListItem
      key={index}
      label={solution.title}
      description={
        <VStack gap={1}>
          <Text type="supporting">{solution.description}</Text>
          <Text type="supporting" color="secondary">
            {[solution.owner, solution.deadline && `by ${solution.deadline}`, solution.cost].filter(Boolean).join(" · ")}
          </Text>
          {solution.approval && (
            <Text type="supporting" color="secondary">
              Approval: {solution.approval}
            </Text>
          )}
        </VStack>
      }
      startContent={
        <VStack gap={1}>
          <Badge label={SOLUTION_KIND[solution.kind] ?? solution.kind} variant="neutral" />
          {solution.stage === "parallel" && <Badge label="In parallel" variant="info" />}
        </VStack>
      }
      endContent={
        solution.email ? (
          <Button
            label={solution.status === "sent" ? "Sent" : "Review email"}
            variant={solution.status === "sent" ? "secondary" : "primary"}
            size="sm"
            onClick={() => setOpen(index)}
          />
        ) : undefined
      }
    />
  );

  const first = (notification.data.suppliers ?? [])[0]?.name;
  return (
    <VStack gap={4}>
      {now.length > 0 && (
        <List density="compact" listStyle="decimal" hasDividers>
          {now.map(item)}
        </List>
      )}
      {planB.length > 0 && (
        <VStack gap={2}>
          <Heading level={4}>Plan B</Heading>
          <Text type="supporting" color="secondary">
            Only if {first ?? "the supplier asked first"} cannot deliver.
          </Text>
          <List density="compact" hasDividers>
            {planB.map(item)}
          </List>
        </VStack>
      )}
      {open !== null && solutions[open] && (
        <SolutionEmailDialog
          notification={notification}
          index={open}
          solution={solutions[open].solution}
          onClose={() => setOpen(null)}
          onSent={() => {
            setOpen(null);
            onChanged();
          }}
        />
      )}
    </VStack>
  );
}

/** Popup to review, edit, approve and send a solution's email. */
function SolutionEmailDialog({
  notification,
  index,
  solution,
  onClose,
  onSent,
}: {
  notification: Notification;
  index: number;
  solution: Solution;
  onClose: () => void;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && !busy && onClose()} width={680} maxHeight="88dvh" purpose="form" padding={0}>
      <ComposeWindow
        context={notification.data.title ?? ""}
        title={solution.title}
        draft={draft}
        translation={solution.email?.translation}
        approval={sent ? undefined : solution.approval}
        busy={busy}
        error={error}
        onClose={onClose}
        onSend={sent ? undefined : (edited, approvedBy) => void send(edited, approvedBy)}
        status={sent ? `Sent${solution.approved_by ? ` · approved by ${solution.approved_by}` : ""}` : undefined}
      />
    </Dialog>
  );
}
