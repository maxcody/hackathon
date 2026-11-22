import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  BellIcon,
  ChartBarSquareIcon,
  InboxIcon,
  Squares2X2Icon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { TopNav } from "@astryxdesign/core/TopNav";
import { Layout, LayoutContent, HStack, VStack, StackItem } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { List, ListItem } from "@astryxdesign/core/List";
import { TextInput } from "@astryxdesign/core/TextInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Popover } from "@astryxdesign/core/Popover";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { getSkillRun, importMaster, importSheets, listNotifications, sendSolutionEmail, startSkillRun, syncPortal, updateNotificationData } from "./api";
import type { Notification, Severity, SkillRun, Solution } from "./types";
import { ComposeWindow } from "./EmailDraft";
import type { Draft } from "./EmailDraft";
import { AgentsPage } from "./AgentsPage";
import { ReadinessPanel } from "./ReadinessPanel";
import { InboxPage } from "./InboxPage";
import { DataPage } from "./DataPage";
import { localTime, timeToLaunch } from "./time";

const severityOrder: Severity[] = ["critical", "warning", "info"];
const REFRESH_MS = 30 * 1000;

/** Normalize a notification's free-text severity to a known level. */
function severityOf(notification: Notification): Severity {
  const value = String(notification.data.severity ?? "").toLowerCase();
  return (severityOrder as string[]).includes(value) ? (value as Severity) : "info";
}

/** Whether a notification still needs a person. */
function isOpen(notification: Notification): boolean {
  return (notification.data.status ?? "open") !== "resolved";
}

function severityVariant(severity: Severity): "error" | "warning" | "info" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

function severityDot(severity: Severity): "error" | "warning" | "accent" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warning";
  return "accent";
}

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

  const issues = location === "#issues" || location.startsWith("#n-");
  const navLocation = issues ? "#issues" : location;

  let page;
  if (location === "#agents") page = <AgentsPage />;
  else if (location === "#inbox") page = <InboxPage />;
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
  } else if (issues) {
    page = (
      <IssuesPage
        notifications={notifications}
        refresh={refresh}
        focus={location.startsWith("#n-") ? location.slice(1) : null}
      />
    );
  } else {
    page = <Dashboard notifications={notifications} />;
  }

  return (
    <AppShell
      height="fill"
      variant="elevated"
      sideNav={<AppSideNav location={navLocation} />}
      topNav={
        <TopNav
          label={pageTitle(navLocation)}
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
  if (location === "#agents") return "Agents";
  if (location === "#issues") return "Issues";
  return "Overview";
}

/** Workspace navigation with the launch countdown. */
function AppSideNav({ location }: { location: string }) {
  const current = location === "#issues" ? "#overview" : location;
  return (
    <SideNav
      collapsible
      header={
        <SideNavHeading heading="Linewatch" headingHref="#overview" />
      }
      footer={
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
function Dashboard({ notifications }: { notifications: Notification[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = notifications.filter(isOpen);
  const critical = open.filter((n) => severityOf(n) === "critical").length;

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
      contentWidth={1200}
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
              <Button
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

            <Card padding={4} elevation="low">
              <HStack gap={4} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <VStack gap={1}>
                    <HStack gap={2} vAlign="center">
                      <Text weight="semibold">{open.length} open issues</Text>
                      {critical > 0 && <Badge label={`${critical} critical`} variant="error" />}
                    </HStack>
                    <Text type="supporting" color="secondary">
                      What the agents found, with proposed solutions
                    </Text>
                  </VStack>
                </StackItem>
                <Button label="View issues" variant="primary" href="#issues" />
              </HStack>
            </Card>

            <ReadinessPanel notifications={notifications} />
          </VStack>
        </LayoutContent>
      }
    />
  );
}

/** Issues page: everything the agents found, with solutions, and the risk check. */
function IssuesPage({
  notifications,
  refresh,
  focus,
}: {
  notifications: Notification[];
  refresh: () => Promise<void>;
  focus: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ block: "start" });
  }, [focus]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...notifications]
      .filter((n) => showResolved || isOpen(n) || `n-${n.id}` === focus)
      .filter((n) => filter === "all" || severityOf(n) === filter)
      .filter(
        (n) =>
          !normalized ||
          [n.data.title, n.data.details, n.data.kind, n.attr, n.erp_val, n.customer_val, ...(n.data.refs ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(normalized),
      )
      .sort(
        (a, b) =>
          severityOrder.indexOf(severityOf(a)) - severityOrder.indexOf(severityOf(b)) ||
          b.seen_at.localeCompare(a.seen_at),
      );
  }, [notifications, filter, query, showResolved, focus]);

  const counts = useMemo(() => {
    const initial: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
    for (const n of notifications) if (isOpen(n)) initial[severityOf(n)] += 1;
    return initial;
  }, [notifications]);
  const openTotal = counts.critical + counts.warning + counts.info;

  async function setStatus(notification: Notification, status: string) {
    setError(null);
    try {
      await updateNotificationData(notification.id, { ...notification.data, status });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the issue.");
    }
  }

  return (
    <Layout
      height="fill"
      contentWidth={1200}
      content={
        <LayoutContent role="main" id="issues">
          <VStack gap={6} padding={6}>
            <HStack gap={4} vAlign="end" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={1}>Issues</Heading>
                  <Text color="secondary">
                    Where the ERP disagrees with paperwork, suppliers or the launch plan, with proposed
                    solutions.
                  </Text>
                </VStack>
              </StackItem>
              <RiskCheck onFinished={refresh} />
            </HStack>

            {error && (
              <Banner
                status="error"
                title={error}
                isDismissable
                onDismiss={() => setError(null)}
              />
            )}

            <Section padding={0}>
              <VStack gap={4}>
                <HStack gap={3} vAlign="center" wrap="wrap">
                  <SegmentedControl
                    label="Filter issues"
                    value={filter}
                    onChange={(value) => setFilter(value as "all" | Severity)}
                  >
                    <SegmentedControlItem value="all" label={`All (${openTotal})`} />
                    <SegmentedControlItem value="critical" label={`Critical (${counts.critical})`} />
                    <SegmentedControlItem value="warning" label={`Warning (${counts.warning})`} />
                    <SegmentedControlItem value="info" label={`Info (${counts.info})`} />
                  </SegmentedControl>
                  <Button
                    label="Resolved"
                    variant={showResolved ? "primary" : "secondary"}
                    onClick={() => setShowResolved((value) => !value)}
                  />
                  <StackItem size="fill">
                    <TextInput
                      label="Search issues"
                      isLabelHidden
                      type="search"
                      placeholder="Search a part, file or issue"
                      value={query}
                      onChange={setQuery}
                      startIcon="search"
                      hasClear
                    />
                  </StackItem>
                </HStack>

                {visible.length ? (
                  <VStack gap={3}>
                    {visible.map((n) => (
                      <NotificationCard
                        key={n.id}
                        notification={n}
                        onStatus={setStatus}
                        onChanged={() => void refresh()}
                      />
                    ))}
                  </VStack>
                ) : (
                  <EmptyState
                    title={notifications.length ? "Nothing matches this filter." : "No issues yet"}
                    description={
                      notifications.length
                        ? undefined
                        : "Run the risk check to let an agent go through the data."
                    }
                  />
                )}
              </VStack>
            </Section>
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

  const when = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const status = running
    ? `Running since ${when(run?.started_at)} · takes a few minutes`
    : run?.status === "done"
      ? `Last run ${when(run.finished_at)}`
      : run?.status === "failed"
        ? `Last run failed: ${run.error ?? ""}`
        : "Not run yet";

  return (
    <VStack gap={1} hAlign="end">
      <Button
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

/** Display one notification: what differs, why it matters, how to solve it. */
function NotificationCard({
  notification: n,
  onStatus,
  onChanged,
}: {
  notification: Notification;
  onStatus: (n: Notification, status: string) => void;
  onChanged: () => void;
}) {
  const severity = severityOf(n);
  const status = n.data.status ?? "open";
  const refs = n.data.refs ?? [];
  const kind = (n.data.kind ?? "").replace(/_/g, " ");

  return (
    <Card id={`n-${n.id}`} padding={4} elevation="low" variant={status === "resolved" ? "muted" : "default"}>
      <VStack gap={3}>
        <HStack gap={3} vAlign="start" wrap="wrap">
          <StackItem size="fill">
            <VStack gap={1}>
              <HStack gap={2} vAlign="center">
                <StatusDot variant={severityDot(severity)} label={severity} />
                <Text type="supporting" color="secondary">
                  {severity}
                  {kind ? ` · ${kind}` : ""}
                </Text>
              </HStack>
              <Heading level={3}>{n.data.title || `${n.attr} mismatch`}</Heading>
            </VStack>
          </StackItem>
          <HStack gap={2} vAlign="center">
            <Badge label={status.replace("_", " ")} variant={severityVariant(severity)} />
            <Button
              label={status === "resolved" ? "Reopen" : "Resolve"}
              variant="secondary"
              size="sm"
              onClick={() => onStatus(n, status === "resolved" ? "open" : "resolved")}
            />
          </HStack>
        </HStack>

        {(n.erp_val || n.customer_val) && (
          <HStack gap={4} wrap="wrap">
            <VStack gap={0}>
              <Text type="supporting" color="secondary">
                ERP · {n.attr.replace(/_/g, " ")}
              </Text>
              <Text weight="semibold">{n.erp_val ?? "–"}</Text>
            </VStack>
            <VStack gap={0}>
              <Text type="supporting" color="secondary">
                Actual
              </Text>
              <Text weight="semibold">{n.customer_val ?? "–"}</Text>
            </VStack>
          </HStack>
        )}

        {n.data.details && <Text color="secondary">{n.data.details}</Text>}
        {(n.data.solutions ?? []).length > 0 && <SolutionList notification={n} onChanged={onChanged} />}

        <HStack gap={3} vAlign="center" wrap="wrap">
          {refs.length > 0 && (
            <Text type="supporting" color="secondary">
              {refs.length} {refs.length === 1 ? "source" : "sources"}: {refs.join(", ")}
            </Text>
          )}
          <Text type="supporting" color="secondary">
            Last seen {localTime(n.seen_at)}
            {n.data.status_note ? ` · ${n.data.status_note}` : ""}
          </Text>
        </HStack>
      </VStack>
    </Card>
  );
}

const SOLUTION_KIND: Record<Solution["kind"], string> = {
  email: "Email",
  claim: "Claim",
  internal: "Internal",
  decision: "Decision",
};

/** Proposed solutions of a notification; email solutions open a review popup. */
function SolutionList({ notification, onChanged }: { notification: Notification; onChanged: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const solutions = notification.data.solutions ?? [];

  return (
    <VStack gap={2}>
      <Heading level={4}>How to solve it</Heading>
      <List density="compact" listStyle="decimal" hasDividers>
        {solutions.map((solution, index) => (
          <ListItem
            key={index}
            label={solution.title}
            description={
              <VStack gap={1}>
                <Text type="supporting">{solution.description}</Text>
                <Text type="supporting" color="secondary">
                  {[solution.owner, solution.deadline && `by ${solution.deadline}`, solution.cost]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {solution.approval && (
                  <Text type="supporting" color="secondary">
                    Approval: {solution.approval}
                  </Text>
                )}
              </VStack>
            }
            startContent={<Badge label={SOLUTION_KIND[solution.kind] ?? solution.kind} variant="neutral" />}
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
        ))}
      </List>
      {open !== null && solutions[open] && (
        <SolutionEmailDialog
          notification={notification}
          index={open}
          solution={solutions[open]}
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
