import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import { Link } from "@astryxdesign/core/Link";
import { Layout, LayoutContent, LayoutPanel, HStack, VStack, StackItem } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { LoadingButton } from "./LoadingButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Badge } from "@astryxdesign/core/Badge";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { List, ListItem } from "@astryxdesign/core/List";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { getMailbox, reanalyzeEmail } from "./api";
import type { MailMessage, Mailbox } from "./types";

const REFRESH_MS = 30 * 1000;
const STATUS_LABEL: Record<string, string> = {
  requests: "Accepted",
  deferred: "Delayed",
  delivered: "Delivered",
  opened: "Opened",
  clicks: "Clicked",
  softBounces: "Soft bounce",
  hardBounces: "Bounced",
  blocked: "Blocked",
  invalid: "Invalid address",
  error: "Error",
  spam: "Marked as spam",
};
const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  delivered: "success",
  opened: "success",
  clicks: "success",
  requests: "warning",
  deferred: "warning",
};

/** Short time label: today shows the time, older mail the date. */
function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Analysis state of a received mail in the list. */
function AnalysisChip({ message }: { message: MailMessage }) {
  if (message.direction !== "in") return null;
  const status = message.analysis?.status;
  const [variant, label]: ["success" | "error" | "warning", string] =
    status === "done"
      ? ["success", "Analyzed"]
      : status === "failed"
        ? ["error", "Analysis failed"]
        : ["warning", "Analyzing…"];
  return <Badge label={label} variant={variant} />;
}

/** The agent's reading of a received mail. */
function AnalysisPanel({ message, onRetry }: { message: MailMessage; onRetry: () => void }) {
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
      <Card padding={4} variant="muted">
        <VStack gap={2}>
          <Text weight="semibold">Agent analysis</Text>
          <Text color="secondary">
            An agent is reading this email. The analysis appears here in a minute or two.
          </Text>
        </VStack>
      </Card>
    );
  }
  if (analysis.status === "failed") {
    return (
      <Card padding={4} variant="red">
        <VStack gap={2}>
          <Text weight="semibold">Agent analysis failed</Text>
          <Text>{analysis.error}</Text>
          <LoadingButton
            label={busy ? "Restarting…" : "Analyze again"}
            variant="secondary"
            isLoading={busy}
            onClick={() => void retry()}
          />
        </VStack>
      </Card>
    );
  }
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Text weight="semibold">Agent analysis</Text>
            {analysis.language && <Badge label={analysis.language.toUpperCase()} variant="neutral" />}
          </HStack>
          <LoadingButton
            label={busy ? "Restarting…" : "Analyze again"}
            variant="ghost"
            size="sm"
            isLoading={busy}
            onClick={() => void retry()}
          />
        </HStack>
        <Text>{analysis.summary}</Text>
        {analysis.commitments.length > 0 && (
          <List density="compact">
            {analysis.commitments.map((c, index) => (
              <ListItem
                key={index}
                label={c.what}
                description={[c.quantity, c.date, c.price].filter(Boolean).join(" · ") || undefined}
              />
            ))}
          </List>
        )}
        {analysis.risks && (
          <Text>
            <Text weight="semibold">Risk: </Text>
            {analysis.risks}
          </Text>
        )}
        {analysis.next_step && (
          <Text>
            <Text weight="semibold">Next step: </Text>
            {analysis.next_step}
          </Text>
        )}
        {analysis.notification_keys.length > 0 && (
          <Text type="supporting" color="secondary">
            Updated issues: {analysis.notification_keys.join(", ")}
          </Text>
        )}
        {analysis.translation && (
          <Section padding={3} variant="muted">
            <VStack gap={1}>
              <Text weight="semibold">English translation</Text>
              <Text color="secondary">{analysis.translation}</Text>
            </VStack>
          </Section>
        )}
      </VStack>
    </Card>
  );
}

/** Delivery status chip for outgoing mail. */
function StatusChip({ message }: { message: MailMessage }) {
  if (!message.status) return null;
  return (
    <Badge
      label={STATUS_LABEL[message.status] ?? message.status}
      variant={STATUS_VARIANT[message.status] ?? "error"}
    />
  );
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

  const messages = useMemo(
    () => (box?.messages ?? []).filter((m) => folder === "all" || m.direction === folder),
    [box, folder],
  );
  const open = messages.find((m) => m.message_id === selected) ?? messages[0];
  const original = open?.in_reply_to
    ? box?.messages.find((m) => m.message_id === open.in_reply_to)
    : undefined;

  const counts = useMemo(() => {
    const all = box?.messages ?? [];
    return {
      all: all.length,
      in: all.filter((m) => m.direction === "in").length,
      out: all.filter((m) => m.direction === "out").length,
    };
  }, [box]);

  return (
    <Layout
      height="fill"
      header={
        <VStack gap={3} padding={4} paddingBlockEnd={0}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Heading level={1}>Inbox</Heading>
            <StackItem size="fill">
              <TabList value={folder} onChange={(value) => setFolder(value as "all" | "in" | "out")} hasDivider>
                <Tab value="all" label={`All (${counts.all})`} />
                <Tab value="in" label={`Received (${counts.in})`} />
                <Tab value="out" label={`Sent (${counts.out})`} />
              </TabList>
            </StackItem>
            {box?.sender && (
              <Text type="supporting" color="secondary">
                {box.sender}
              </Text>
            )}
            <LoadingButton
              label={loading ? "Refreshing…" : "Refresh"}
              variant="secondary"
              icon={<Icon icon={ArrowPathIcon} size="sm" />}
              isLoading={loading}
              onClick={() => void load()}
            />
          </HStack>
          {error && <Banner status="error" title={error} />}
          {box && !box.incoming_configured && folder !== "out" && (
            <Banner
              status="info"
              title={`Received mail is not connected yet. Supplier replies go to ${box.sender ?? "the sender address"}; connect it with the Gmail Apps Script (see README, "Inbox").`}
            />
          )}
          {box?.incoming_error && <Banner status="error" title={box.incoming_error} />}
        </VStack>
      }
      start={
        <LayoutPanel width={360} hasDivider label="Messages" padding={0}>
          {!box && !error ? (
            <EmptyState title="Loading…" isCompact />
          ) : messages.length === 0 ? (
            <EmptyState title="No messages." isCompact />
          ) : (
            <List density="balanced" hasDividers>
              {messages.map((m) => (
                <ListItem
                  key={m.message_id}
                  align="start"
                  label={
                    <Text weight="semibold" maxLines={1}>
                      {m.direction === "out" ? `To: ${m.to.join(", ")}` : m.sender}
                    </Text>
                  }
                  description={
                    <VStack gap={0}>
                      <Text maxLines={1}>{m.subject || "(no subject)"}</Text>
                      <Text type="supporting" color="secondary" maxLines={1}>
                        {m.body.replace(/\s+/g, " ")}
                      </Text>
                      {m.direction === "out" && m.status && (
                        <Text type="supporting" color="secondary">
                          {STATUS_LABEL[m.status] ?? m.status}
                        </Text>
                      )}
                    </VStack>
                  }
                  endContent={
                    <VStack gap={1} hAlign="end">
                      <Text type="supporting" color="secondary" hasTabularNumbers>
                        {when(m.at)}
                      </Text>
                      <AnalysisChip message={m} />
                    </VStack>
                  }
                  isSelected={open?.message_id === m.message_id}
                  onClick={() => setSelected(m.message_id)}
                />
              ))}
            </List>
          )}
        </LayoutPanel>
      }
      content={
        <LayoutContent role="main" id="inbox">
          {open ? (
            <VStack gap={5} padding={6}>
              {/* Mail header: subject, then sender with recipients and date, like a mail client */}
              <Heading level={2}>{open.subject || "(no subject)"}</Heading>
              <HStack gap={3} vAlign="start">
                <Avatar name={open.sender || "?"} size="md" />
                <StackItem size="fill">
                  <VStack gap={0}>
                    <Text weight="semibold">{open.sender || "–"}</Text>
                    <Text type="supporting" color="secondary">
                      To: {open.to.join(", ")}
                    </Text>
                    {open.cc.length > 0 && (
                      <Text type="supporting" color="secondary">
                        Cc: {open.cc.join(", ")}
                      </Text>
                    )}
                    {original && (
                      <Text type="supporting" color="secondary">
                        In reply to{" "}
                        <Link
                          href="#inbox"
                          type="supporting"
                          onClick={(event) => {
                            event.preventDefault();
                            setFolder("all");
                            setSelected(original.message_id);
                          }}
                        >
                          {original.subject || "(no subject)"}
                        </Link>
                      </Text>
                    )}
                  </VStack>
                </StackItem>
                <VStack gap={1} hAlign="end">
                  <Text type="supporting" color="secondary">
                    <Timestamp value={open.at} format="date_time" />
                  </Text>
                  {open.direction === "out" &&
                    (open.status ? (
                      <StatusChip message={open} />
                    ) : (
                      <Text type="supporting" color="secondary">
                        {box?.status_source ? "No delivery event yet" : "Delivery status unknown"}
                      </Text>
                    ))}
                </VStack>
              </HStack>
              <Divider />
              {open.direction === "in" && <AnalysisPanel message={open} onRetry={() => void load()} />}
              {/* The body as written: paragraphs on blank lines, single line breaks kept */}
              <VStack gap={4}>
                {open.body.split(/\n\s*\n/).map((paragraph, index) => (
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
            </VStack>
          ) : (
            <EmptyState title="Select a message." />
          )}
        </LayoutContent>
      }
    />
  );
}
