import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Layout, LayoutContent, LayoutPanel, VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Breadcrumbs, BreadcrumbItem } from "@astryxdesign/core/Breadcrumbs";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { getSourcing, updateNotificationData } from "./api";
import type { Notification, Source, ThreadSummary } from "./types";
import {
  SolutionList,
  SupplierChain,
  componentOf,
  issueTitle,
  openSolutions,
  severityDot,
  severityOf,
  severityVariant,
  supplierState,
} from "./issues";
import { IssueConversation, threadState } from "./IssueThread";
import { ComparisonBar, FactGrid, SourceFiles } from "./IssueCard";
import { localTime } from "./time";

export type IssueTab = "overview" | "solutions" | "conversation";

/** Hash of an issue page, e.g. "#n-12/conversation". */
export function issueHref(id: number, tab: IssueTab = "overview"): string {
  return tab === "overview" ? `#n-${id}` : `#n-${id}/${tab}`;
}

/** Parse "#n-12/solutions" into id and tab. */
export function parseIssueHash(hash: string): { id: number; tab: IssueTab } | null {
  const match = hash.match(/^#[nt]-(\d+)(?:\/(\w+))?$/);
  if (!match) return null;
  const tab = (["solutions", "conversation"] as const).find((t) => t === match[2]);
  // "#t-12" was the old conversation link
  return { id: Number(match[1]), tab: tab ?? (hash.startsWith("#t-") ? "conversation" : "overview") };
}

const ROLE: Record<Source["role"], string> = {
  primary: "Primary",
  second_source: "Second source",
  same_category: "Same category",
};

/** The value a field had in the ERP versus reality, side by side. */
function Comparison({ n }: { n: Notification }) {
  if (!n.erp_val && !n.customer_val) return null;
  return (
    <HStack gap={8} wrap="wrap">
      <VStack gap={1}>
        <Text type="supporting" color="secondary">ERP · {n.attr.replace(/_/g, " ")}</Text>
        <Heading level={3}>{n.erp_val ?? "–"}</Heading>
      </VStack>
      <VStack gap={1}>
        <Text type="supporting" color="secondary">Actual</Text>
        <Heading level={3}>{n.customer_val ?? "–"}</Heading>
      </VStack>
    </HStack>
  );
}

/** Side panel: suppliers asked so far, who else can supply, and key facts. */
function SupplierPanel({ n, sources, onWrite }: { n: Notification; sources: Source[]; onWrite: (address: string) => void }) {
  const asked = n.data.suppliers ?? [];
  const state = new Map(asked.map((s) => [s.supplier_id, s.state]));
  const part = componentOf(n);
  return (
    <VStack gap={5} padding={4}>
      <VStack gap={2}>
        <Heading level={4}>Suppliers asked</Heading>
        {asked.length ? (
          <VStack gap={2}>
            <SupplierChain suppliers={asked} />
            {asked.filter((s) => s.note || s.quantity).map((s) => (
              <Text key={s.supplier_id} type="supporting" color="secondary">
                {s.name}: {[s.quantity, s.note].filter(Boolean).join(" · ")}
              </Text>
            ))}
          </VStack>
        ) : (
          <Text type="supporting" color="secondary">No supplier contacted yet.</Text>
        )}
      </VStack>
      <Divider />
      <VStack gap={3}>
        <Heading level={4}>Who can supply {part ?? "this part"}</Heading>
        {!part ? (
          <Text type="supporting" color="secondary">This issue is not about a single part.</Text>
        ) : sources.length === 0 ? (
          <Text type="supporting" color="secondary">No supplier lists this part.</Text>
        ) : (
          sources.map((s) => {
            const current = state.get(s.supplier_id);
            const facts = [
              s.share != null ? `${Math.round(s.share * 100)} % share` : "",
              s.lead_time_days != null ? `${s.lead_time_days} d lead time` : "",
              s.unit_price != null ? `${s.unit_price} ${s.currency}` : "",
            ].filter(Boolean);
            return (
              <Card key={s.supplier_id} padding={3} variant={current === "declined" ? "muted" : "default"}>
                <VStack gap={2}>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <StackItem size="fill">
                      <Text weight="semibold">{s.name}</Text>
                    </StackItem>
                    {current ? (
                      <Badge label={supplierState(current).label} variant={supplierState(current).variant} />
                    ) : (
                      <Badge label={ROLE[s.role]} variant="neutral" />
                    )}
                  </HStack>
                  {facts.length > 0 && <Text type="supporting" color="secondary">{facts.join(" · ")}</Text>}
                  {s.needs_approval && (
                    <Text type="supporting" color="secondary">
                      {s.role === "same_category" ? "Not qualified for this part: sample and PP-07 approval" : "Conditional supplier: PP-07 approval"}
                    </Text>
                  )}
                  {current !== "declined" && s.contact_email && (
                    <HStack>
                      <Button label={current ? "Write again" : "Ask this supplier"} variant="secondary" size="sm" onClick={() => onWrite(s.contact_email)} />
                    </HStack>
                  )}
                </VStack>
              </Card>
            );
          })
        )}
      </VStack>
      <Divider />
      <VStack gap={1}>
        <Heading level={4}>Details</Heading>
        {part && <Text type="supporting" color="secondary">Part {part}</Text>}
        <Text type="supporting" color="secondary">Last seen {localTime(n.seen_at)}</Text>
        {n.data.key && <Text type="supporting" color="secondary">Key {n.data.key}</Text>}
      </VStack>
    </VStack>
  );
}

/**
 * One issue on its own page: header with navigation, tabs for what is wrong,
 * how to solve it and the supplier conversation, and a supplier side panel.
 */
export function IssuePage({
  notification: n,
  ordered,
  tab,
  thread,
  refresh,
  onThreadsChanged,
}: {
  notification: Notification | undefined;
  /** All issues in list order, for previous / next. */
  ordered: Notification[];
  tab: IssueTab;
  thread?: ThreadSummary;
  refresh: () => Promise<void>;
  onThreadsChanged: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [writeTo, setWriteTo] = useState<{ address: string; nonce: number } | null>(null);
  const [error, setError] = useState("");
  const part = n ? componentOf(n) : null;

  useEffect(() => {
    setSources([]);
    if (part) getSourcing(part).then(setSources).catch(() => undefined);
  }, [part]);

  useEffect(() => {
    document.getElementById("issue-page")?.scrollTo({ top: 0 });
  }, [n?.id, tab]);

  if (!n) {
    return (
      <Layout
        height="fill"
        content={
          <LayoutContent>
            <EmptyState title="This issue no longer exists." description="It may have been merged or deleted." actions={<Button label="Back to issues" variant="primary" onClick={() => (window.location.hash = "#issues")} />} />
          </LayoutContent>
        }
      />
    );
  }

  const index = ordered.findIndex((item) => item.id === n.id);
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const severity = severityOf(n);
  const status = n.data.status ?? "open";
  const solutions = n.data.solutions ?? [];
  const todo = openSolutions(n);
  const conversation = threadState(thread);

  async function setStatus(value: string) {
    setError("");
    try {
      await updateNotificationData(n!.id, { ...n!.data, status: value });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the issue.");
    }
  }

  function write(address: string) {
    setWriteTo({ address, nonce: Date.now() });
    window.location.hash = issueHref(n!.id, "conversation");
  }

  return (
    <Layout
      height="fill"
      header={
        <VStack gap={3} padding={6} paddingInline={10} paddingBlockEnd={0}>
          <HStack gap={3} vAlign="center">
            <StackItem size="fill">
              <Breadcrumbs label="Location">
                <BreadcrumbItem href="#overview">Overview</BreadcrumbItem>
                <BreadcrumbItem href="#issues">Issues</BreadcrumbItem>
                <BreadcrumbItem isCurrent>{part ?? `Issue ${n.id}`}</BreadcrumbItem>
              </Breadcrumbs>
            </StackItem>
            {index >= 0 && (
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {index + 1} of {ordered.length}
              </Text>
            )}
            <IconButton label="Previous issue" variant="ghost" size="sm" icon={<Icon icon={ChevronLeftIcon} size="sm" />} isDisabled={!previous} onClick={() => previous && (window.location.hash = issueHref(previous.id, tab))} />
            <IconButton label="Next issue" variant="ghost" size="sm" icon={<Icon icon={ChevronRightIcon} size="sm" />} isDisabled={!next} onClick={() => next && (window.location.hash = issueHref(next.id, tab))} />
          </HStack>
          <HStack gap={4} vAlign="start" wrap="wrap">
            <StackItem size="fill">
              <VStack gap={1}>
                <HStack gap={2} vAlign="center">
                  <StatusDot variant={severityDot(severity)} label={severity} />
                  <Text type="supporting" color="secondary">
                    {severity}
                    {n.data.kind ? ` · ${n.data.kind.replace(/_/g, " ")}` : ""}
                  </Text>
                  <Badge label={status.replace("_", " ")} variant={status === "resolved" ? "success" : severityVariant(severity)} />
                </HStack>
                <Heading level={1}>{issueTitle(n)}</Heading>
                {n.data.status_note && <Text color="secondary">{n.data.status_note}</Text>}
              </VStack>
            </StackItem>
            <Button label={status === "resolved" ? "Reopen" : "Mark resolved"} variant="secondary" onClick={() => void setStatus(status === "resolved" ? "open" : "resolved")} />
          </HStack>
          <TabList value={tab} onChange={(value) => (window.location.hash = issueHref(n.id, value as IssueTab))} hasDivider>
            <Tab value="overview" label="Overview" />
            <Tab value="solutions" label={`Solutions (${solutions.length})`} />
            <Tab
              value="conversation"
              label={`Conversation${thread ? ` (${thread.count})` : ""}`}
              endContent={thread?.last_direction === "in" ? <StatusDot variant="accent" label="Supplier replied" /> : undefined}
            />
          </TabList>
        </VStack>
      }
      content={
        <LayoutContent role="main" id="issue-page">
          <VStack gap={5} padding={6}>
            {error && <Banner status="error" title={error} isDismissable onDismiss={() => setError("")} />}
            {tab === "overview" && (
              <>
                <Card padding={5}>
                  <VStack gap={4}>
                    <Heading level={3}>What is wrong</Heading>
                    {n.data.headline && <Text weight="medium">{n.data.headline}</Text>}
                    {/* The agent's key figures when it gave them, else the ERP-vs-actual comparison */}
                    {n.data.facts?.length ? <FactGrid facts={n.data.facts} /> : <Comparison n={n} />}
                    <ComparisonBar n={n} />
                    {n.data.details && <Text>{n.data.details}</Text>}
                    <SourceFiles paths={n.data.refs ?? []} />
                  </VStack>
                </Card>
                <Card padding={5}>
                  <VStack gap={3}>
                    <HStack gap={2} vAlign="center">
                      <StackItem size="fill"><Heading level={3}>Next step</Heading></StackItem>
                      {conversation && <Badge label={conversation.label} variant={conversation.variant} />}
                    </HStack>
                    {todo.length ? (
                      <>
                        <Text weight="semibold">{todo[0].title}</Text>
                        <Text color="secondary">{todo[0].description}</Text>
                        <HStack gap={2} wrap="wrap">
                          <Button label={todo[0].email ? "Review the email" : "See all solutions"} variant="primary" onClick={() => (window.location.hash = issueHref(n.id, "solutions"))} />
                          {thread && <Button label="Open conversation" variant="secondary" onClick={() => (window.location.hash = issueHref(n.id, "conversation"))} />}
                        </HStack>
                      </>
                    ) : thread ? (
                      <>
                        <Text color="secondary">All proposed actions are done. Follow the supplier's answers in the conversation.</Text>
                        <HStack><Button label="Open conversation" variant="primary" onClick={() => (window.location.hash = issueHref(n.id, "conversation"))} /></HStack>
                      </>
                    ) : (
                      <Text color="secondary">No solution proposed yet. Run the risk check on the Issues page, or ask a supplier from the panel on the right.</Text>
                    )}
                  </VStack>
                </Card>
              </>
            )}
            {tab === "solutions" &&
              (solutions.length ? (
                <SolutionList
                  notification={n}
                  onChanged={() => {
                    void refresh();
                    onThreadsChanged();
                  }}
                />
              ) : (
                <EmptyState title="No solutions yet" description="The risk check proposes solutions when it finds a problem." />
              ))}
            {tab === "conversation" && (
              <IssueConversation
                notification={n}
                sources={sources}
                writeTo={writeTo}
                onSent={() => {
                  void refresh();
                  onThreadsChanged();
                }}
              />
            )}
          </VStack>
        </LayoutContent>
      }
      end={
        <LayoutPanel width={340} hasDivider label="Suppliers">
          <SupplierPanel n={n} sources={sources} onWrite={write} />
        </LayoutPanel>
      }
    />
  );
}
