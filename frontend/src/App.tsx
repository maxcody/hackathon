import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  BellIcon,
  ChartBarSquareIcon,
  FolderIcon,
  InboxIcon,
  Squares2X2Icon,
  CpuChipIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { Layout, LayoutContent, HStack, VStack, StackItem } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { LoadingButton } from "./LoadingButton";
import { Badge } from "@astryxdesign/core/Badge";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { List, ListItem } from "@astryxdesign/core/List";
import { TextInput } from "@astryxdesign/core/TextInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { Grid } from "@astryxdesign/core/Grid";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Popover } from "@astryxdesign/core/Popover";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Divider } from "@astryxdesign/core/Divider";
import { getSkillRun, getThreadSummaries, importMaster, importSheets, listNotifications, startSkillRun, syncPortal } from "./api";
import type { Fact, Notification, Severity, SkillRun, ThreadSummary } from "./types";
import { AgentsPage } from "./AgentsPage";
import { ReadinessPanel } from "./ReadinessPanel";
import { InboxPage } from "./InboxPage";
import { DataPage } from "./DataPage";
import { FilesPage } from "./FilesPage";
import { ComparisonBar } from "./IssueCard";
import { threadState } from "./IssueThread";
import { IssuePage, issueHref, parseIssueHash } from "./IssuePage";
import {
  SupplierChain,
  byPriority,
  isOpen,
  issueTitle,
  openSolutions,
  severityDot,
  severityOf,
  severityOrder,
  severityVariant,
  sortIssues,
} from "./issues";
import { clockTime, localTime, shortTimeToLaunch, timeToLaunch } from "./time";

const REFRESH_MS = 30 * 1000;

/** Build the launch control dashboard with Astryx AppShell chrome. */
export function App() {
  const [location, setLocation] = useState(window.location.hash || "#overview");
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setNotifications(await listNotifications());
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Could not load issues.");
    }
  }, []);

  useEffect(() => {
    const onNavigate = () => setLocation(window.location.hash || "#overview");
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Who wrote last in each issue's email thread; supplier answers arrive in the background
  const [threads, setThreads] = useState<Record<string, ThreadSummary>>({});
  const loadThreads = useCallback(() => {
    getThreadSummaries().then(setThreads).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadThreads();
    const timer = window.setInterval(loadThreads, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadThreads]);

  const issue = parseIssueHash(location);
  const issues = location === "#issues" || issue !== null;
  const navLocation = issues ? "#issues" : location;

  let page;
  if (location === "#agents") page = <AgentsPage />;
  else if (location === "#inbox") page = <InboxPage notifications={notifications ?? []} />;
  else if (location === "#files") page = <FilesPage />;
  else if (location === "#data") page = <DataPage notifications={notifications ?? []} />;
  else if (notifications === null) {
    page = loadError ? (
      <Layout
        height="fill"
        content={
          <LayoutContent>
            <VStack gap={4} hAlign="center" vAlign="center" padding={8}>
              <Heading level={1}>The backend is not reachable.</Heading>
              <Text color="secondary">{loadError}</Text>
              <Button label="Try again" variant="primary" onClick={() => void refresh()} />
            </VStack>
          </LayoutContent>
        }
      />
    ) : (
      <Layout
        height="fill"
        content={
          <LayoutContent>
            <VStack gap={2} hAlign="center" vAlign="center" padding={8}>
              <Text color="secondary">Loading…</Text>
            </VStack>
          </LayoutContent>
        }
      />
    );
  } else if (issue) {
    page = (
      <IssuePage
        notification={notifications.find((n) => n.id === issue.id)}
        ordered={sortIssues(notifications)}
        tab={issue.tab}
        thread={threads[issue.id]}
        refresh={refresh}
        onThreadsChanged={loadThreads}
      />
    );
  } else if (issues) {
    page = <IssuesPage notifications={notifications} threads={threads} refresh={refresh} />;
  } else {
    page = <Dashboard notifications={notifications} threads={threads} />;
  }

  return (
    <AppShell
      height="fill"
      variant="elevated"
      sideNav={<AppSideNav location={navLocation} />}
      topNav={
        <TopNav
          label={pageTitle(navLocation)}
          heading={
            <TopNavHeading
              logo={<img src="/logo.svg" alt="" width={24} height={24} />}
              heading="Linewatch"
              headingHref="#overview"
            />
          }
          endContent={
            <HStack gap={3} vAlign="center">
              <NotificationBell notifications={notifications ?? []} />
              <Avatar name="Soony" size="sm" />
            </HStack>
          }
        />
      }
    >
      {page}
    </AppShell>
  );
}

function pageTitle(location: string): string {
  if (location === "#inbox") return "Inbox";
  if (location === "#data") return "Data";
  if (location === "#files") return "Files";
  if (location === "#agents") return "Agents";
  if (location === "#issues") return "Issues";
  return "Overview";
}

/** Workspace navigation with the launch countdown. */
function AppSideNav({ location }: { location: string }) {
  const current = location;
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SideNav
      collapsible={{ isCollapsed: collapsed, onCollapsedChange: setCollapsed }}
      footer={
        // The rail is too narrow for text: show only the hours left, full text on hover.
        collapsed ? (
          <div className="side-countdown-mini" title={`Launch Sun 22 Nov, 20:00 · ${timeToLaunch()}`}>
            {shortTimeToLaunch()}
          </div>
        ) : (
        // color="inherit" takes the sidebar's light text color from the theme (secondary gray is unreadable on dark green)
        <VStack gap={1} padding={3}>
          <Text type="supporting" color="inherit">
            Soony · Grand Heist 6
          </Text>
          <Text type="supporting" color="inherit">
            Launch Sun 22 Nov, 20:00
          </Text>
          <Text weight="semibold" color="inherit">
            {timeToLaunch()}
          </Text>
        </VStack>
        )
      }
    >
      <SideNavSection title="Workspace" isHeaderHidden>
        <SideNavItem
          label="Overview"
          icon={Squares2X2Icon}
          href="#overview"
          isSelected={current === "#overview"}
        />
        <SideNavItem
          label="Issues"
          icon={ExclamationTriangleIcon}
          href="#issues"
          isSelected={current === "#issues"}
        />
        <SideNavItem
          label="Inbox"
          icon={InboxIcon}
          href="#inbox"
          isSelected={current === "#inbox"}
        />
        <SideNavItem
          label="Data"
          icon={ChartBarSquareIcon}
          href="#data"
          isSelected={current === "#data"}
        />
        <SideNavItem
          label="Files"
          icon={FolderIcon}
          href="#files"
          isSelected={current === "#files"}
        />
        <SideNavItem
          label="Agents"
          icon={CpuChipIcon}
          href="#agents"
          isSelected={current === "#agents"}
        />
      </SideNavSection>
    </SideNav>
  );
}

/** Launch overview: countdown, data sync and readiness; issues live on their own page. */
function Dashboard({ notifications, threads }: { notifications: Notification[]; threads: Record<string, ThreadSummary> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = notifications.filter(isOpen);
  const critical = open.filter((n) => severityOf(n) === "critical").length;
  const ranked = byPriority(notifications, threads);

  async function handleSync() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sync = await syncPortal();
      const master = await importMaster();
      const sheets = await importSheets();
      const sheetRows = Object.values(sheets.rows).reduce((sum, count) => sum + count, 0);
      const failed = sync.failed.length ? ` ${sync.failed.length} files failed to download.` : "";
      setNotice(
        `Portal checked: ${sync.added.length} new, ${sync.changed.length} changed, ${sync.unchanged} unchanged.${failed} Loaded ${master.products} products, ${master.components} components and ${sheetRows} sheet rows.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Portal sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" id="overview">
          <VStack gap={6} padding={6}>
            <HStack gap={4} vAlign="end" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={1}>Grand Heist 6 launch</Heading>
                  <Text color="secondary">
                    Sun 22 Nov, 20:00 · DC Hamburg · {timeToLaunch()}
                  </Text>
                </VStack>
              </StackItem>
              <LoadingButton
                label={busy ? "Syncing…" : "Sync portal data"}
                variant="secondary"
                icon={<Icon icon={ArrowPathIcon} size="sm" />}
                isLoading={busy}
                isDisabled={busy}
                onClick={() => void handleSync()}
                tooltip="Download new portal files and reload the database"
              />
            </HStack>

            {error && (
              <Banner
                status="error"
                title={error}
                isDismissable
                onDismiss={() => setError(null)}
              />
            )}
            {notice && (
              <Banner
                status="success"
                title={notice}
                isDismissable
                onDismiss={() => setNotice(null)}
              />
            )}

            <ReadinessPanel notifications={notifications} />

            {/* What to work on, most urgent first */}
            <VStack gap={3}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <HStack gap={2} vAlign="center">
                    <Heading level={2}>Issues to address</Heading>
                    {critical > 0 && <Badge label={`${critical} critical`} variant="error" />}
                  </HStack>
                </StackItem>
                <Button label={`View all ${open.length}`} variant="secondary" href="#issues" />
              </HStack>
              <Text type="supporting" color="secondary">
                Most urgent first: by severity, then where a supplier answered, then where a proposed action is
                still open.
              </Text>
              {ranked.length ? (
                <VStack gap={2}>
                  <Grid columns={{ minWidth: 320, max: 3 }} gap={3}>
                    {ranked.slice(0, 6).map((n, index) => (
                      <IssueSummary key={n.id} notification={n} thread={threads[n.id]} rank={index + 1} />
                    ))}
                  </Grid>
                  {ranked.length > 6 && (
                    <HStack>
                      <Button label={`${ranked.length - 6} more issues`} variant="ghost" href="#issues" />
                    </HStack>
                  )}
                </VStack>
              ) : (
                <EmptyState title="Nothing open" description="Run the risk check on the Issues page to look for problems." isCompact />
              )}
            </VStack>
          </VStack>
        </LayoutContent>
      }
    />
  );
}

/** Issues page: every problem the agents found, one row each; a row opens the issue page. */
function IssuesPage({
  notifications,
  threads,
  refresh,
}: {
  notifications: Notification[];
  threads: Record<string, ThreadSummary>;
  refresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | "replied" | Severity>("all");
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");
  const replied = useCallback((n: Notification) => threads[n.id]?.last_direction === "in", [threads]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sortIssues(notifications)
      .filter((n) => showResolved || isOpen(n))
      .filter((n) => filter === "all" || (filter === "replied" ? replied(n) : severityOf(n) === filter))
      .filter(
        (n) =>
          !normalized ||
          [n.data.title, n.data.details, n.data.kind, n.attr, n.erp_val, n.customer_val, ...(n.data.refs ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(normalized),
      );
  }, [notifications, filter, query, showResolved, replied]);

  const counts = useMemo(() => {
    const initial: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
    for (const n of notifications) if (isOpen(n)) initial[severityOf(n)] += 1;
    return initial;
  }, [notifications]);
  const openTotal = counts.critical + counts.warning + counts.info;
  const repliedTotal = notifications.filter((n) => isOpen(n) && replied(n)).length;

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" id="issues">
          <VStack gap={6} padding={6}>
            <HStack gap={4} vAlign="end" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={1}>Issues</Heading>
                  <Text color="secondary">
                    Where the ERP disagrees with paperwork, suppliers or the launch plan. Open an issue to see
                    its solutions and the supplier conversation.
                  </Text>
                </VStack>
              </StackItem>
              <RiskCheck onFinished={refresh} />
            </HStack>

            <VStack gap={4}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <SegmentedControl label="Filter issues" value={filter} onChange={(value) => setFilter(value as "all" | "replied" | Severity)}>
                  <SegmentedControlItem value="all" label={`All (${openTotal})`} />
                  <SegmentedControlItem value="critical" label={`Critical (${counts.critical})`} />
                  <SegmentedControlItem value="warning" label={`Warning (${counts.warning})`} />
                  <SegmentedControlItem value="info" label={`Info (${counts.info})`} />
                  <SegmentedControlItem value="replied" label={`Supplier replied (${repliedTotal})`} />
                </SegmentedControl>
                <Button label="Resolved" variant={showResolved ? "primary" : "secondary"} onClick={() => setShowResolved((value) => !value)} />
                <StackItem size="fill">
                  <TextInput label="Search issues" isLabelHidden type="search" placeholder="Search a part, file or issue" value={query} onChange={setQuery} startIcon="search" hasClear />
                </StackItem>
              </HStack>

              {visible.length ? (
                <Grid columns={{ minWidth: 320, max: 3 }} gap={3}>
                  {visible.map((n) => (
                    <IssueSummary key={n.id} notification={n} thread={threads[n.id]} />
                  ))}
                </Grid>
              ) : (
                <EmptyState
                  title={notifications.length ? "Nothing matches this filter." : "No issues yet"}
                  description={notifications.length ? undefined : "Run the risk check to let an agent go through the data."}
                />
              )}
            </VStack>
          </VStack>
        </LayoutContent>
      }
    />
  );
}

/** "Run risk check" with the status of the latest run (it takes a few minutes). */
function RiskCheck({ onFinished }: { onFinished: () => Promise<void> }) {
  const [run, setRun] = useState<SkillRun | null>(null);
  const [error, setError] = useState("");
  const running = run?.status === "running";

  useEffect(() => {
    let previous: string | undefined;
    const poll = () =>
      getSkillRun("risk-check")
        .then((value) => {
          if (previous === "running" && value.status !== "running") void onFinished();
          previous = value.status;
          setRun(value);
        })
        .catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, 10 * 1000);
    return () => window.clearInterval(timer);
  }, [onFinished]);

  async function start() {
    setError("");
    try {
      setRun(await startSkillRun("risk-check"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the risk check.");
    }
  }

  const when = clockTime;
  const status = running
    ? `Running since ${when(run?.started_at)} · takes a few minutes`
    : run?.status === "done"
      ? `Last run ${when(run.finished_at)}`
      : run?.status === "failed"
        ? `Last run failed: ${run.error ?? ""}`
        : "Not run yet";

  return (
    <VStack gap={1} hAlign="end">
      <LoadingButton
        label={running ? "Checking…" : "Run risk check"}
        variant="secondary"
        isLoading={running}
        isDisabled={running}
        onClick={() => void start()}
      />
      <Text type="supporting" color={run?.status === "failed" || error ? "accent" : "secondary"}>
        {error || status}
      </Text>
    </VStack>
  );
}

/** Bell in the top bar: open-notification count and a dropdown of the latest ones. */
function NotificationBell({ notifications }: { notifications: Notification[] }) {
  const [open, setOpen] = useState(false);
  // Most severe first, newest first within a severity: the bell should surface what needs a person now.
  const openItems = notifications
    .filter(isOpen)
    .sort(
      (a, b) =>
        severityOrder.indexOf(severityOf(a)) - severityOrder.indexOf(severityOf(b)) ||
        b.seen_at.localeCompare(a.seen_at),
    );
  const label = (severity: Severity) => severity[0].toUpperCase() + severity.slice(1);
  const short = (value: string) =>
    new Date(value).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const urgent = openItems.some((n) => severityOf(n) === "critical");

  return (
    <HStack gap={1} vAlign="center">
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        placement="below"
        alignment="end"
        width={340}
        padding={0}
        label="Latest notifications"
        hasAutoFocus={false}
        content={
          <VStack gap={0}>
            <HStack gap={2} padding={3} hAlign="between" vAlign="center">
              <Text weight="semibold">Notifications</Text>
              <Text type="supporting" color="secondary">
                {openItems.length} open
              </Text>
            </HStack>
            <Divider />
            {openItems.length ? (
              <List density="compact">
                {openItems.slice(0, 6).map((n) => (
                  <ListItem
                    key={n.id}
                    align="first-line"
                    label={n.data.title || `${n.attr} mismatch`}
                    description={`${label(severityOf(n))} · ${short(n.seen_at)}`}
                    startContent={<StatusDot variant={severityDot(severityOf(n))} label={severityOf(n)} />}
                    href={`#n-${n.id}`}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </List>
            ) : (
              <VStack padding={4}>
                <Text color="secondary">Nothing open right now.</Text>
              </VStack>
            )}
            <Divider />
            <VStack padding={2}>
              <Button
                label="View all issues"
                variant="ghost"
                href="#issues"
                onClick={() => setOpen(false)}
                width="100%"
              />
            </VStack>
          </VStack>
        }
      >
        {openItems.length > 0 ? (
          <Button
            label="Notifications"
            variant="ghost"
            icon={<Icon icon={BellIcon} size="sm" />}
            endContent={
              <Badge
                label={openItems.length > 99 ? "99+" : String(openItems.length)}
                variant={urgent ? "error" : "neutral"}
              />
            }
          />
        ) : (
          <IconButton label="Notifications, none open" variant="ghost" icon={<Icon icon={BellIcon} size="sm" />} />
        )}
      </Popover>
    </HStack>
  );
}

/** The figures to show big: the agent's facts, else the ERP and actual values. */
function factsOf(n: Notification): Fact[] {
  if (n.data.facts?.length) return n.data.facts;
  const attr = n.attr.replace(/_/g, " ");
  return [
    n.erp_val ? { label: `ERP · ${attr}`, value: n.erp_val } : null,
    n.customer_val ? { label: "Actual", value: n.customer_val } : null,
  ].filter((fact): fact is Fact => fact !== null);
}

/** Small card for the issue list: severity, headline, key figures and where the supplier
 * conversation stands; opens the issue page (on the conversation when the supplier replied). */
function IssueSummary({ notification: n, thread, rank }: { notification: Notification; thread?: ThreadSummary; rank?: number }) {
  const severity = severityOf(n);
  const status = n.data.status ?? "open";
  const kind = (n.data.kind ?? "").replace(/_/g, " ");
  const todo = openSolutions(n);
  const conversation = threadState(thread);
  const replied = thread?.last_direction === "in";
  return (
    <a href={issueHref(n.id, replied ? "conversation" : "overview")} className="issue-link">
      {/* Every card fills its grid row; header, headline, two figures, then a footer pinned to the bottom */}
      <Card padding={4} elevation="low" height="100%" variant={status === "resolved" ? "muted" : "default"}>
        <VStack gap={3} height="100%">
          <HStack gap={2} vAlign="center">
            {rank !== undefined && (
              <Text weight="semibold" color="secondary" hasTabularNumbers>
                #{rank}
              </Text>
            )}
            <Badge label={severity} variant={severityVariant(severity)} />
            {kind && (
              <Text type="supporting" color="secondary" maxLines={1}>
                {kind}
              </Text>
            )}
          </HStack>
          <Text weight="medium" maxLines={2}>
            {n.data.headline || issueTitle(n)}
          </Text>
          {factsOf(n)
            .slice(0, 2)
            .map((fact) => (
              <VStack key={fact.label} gap={0}>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {fact.label}
                </Text>
                <Text hasTabularNumbers maxLines={2}>
                  {fact.value}
                </Text>
              </VStack>
            ))}
          <ComparisonBar n={n} compact />
          {(n.data.suppliers ?? []).length > 0 && <SupplierChain suppliers={n.data.suppliers ?? []} />}
          <StackItem size="fill" />
          <Divider />
          <HStack gap={2} vAlign="center" wrap="wrap">
            {status === "resolved" ? (
              <Badge label="resolved" variant="success" />
            ) : conversation ? (
              <Badge label={conversation.label} variant={conversation.variant} />
            ) : status !== "open" ? (
              <Badge label={status.replace("_", " ")} variant="neutral" />
            ) : null}
            <Text type="supporting" color="secondary">
              {todo.length ? `${todo.length} ${todo.length === 1 ? "solution" : "solutions"}` : "No open solutions"}
              {" · "}
              {localTime(n.seen_at)}
            </Text>
          </HStack>
        </VStack>
      </Card>
    </a>
  );
}
