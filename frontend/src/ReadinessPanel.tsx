import { useEffect, useMemo, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Banner } from "@astryxdesign/core/Banner";
import { Link } from "@astryxdesign/core/Link";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Table, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { getReadiness } from "./api";
import type { Notification, PartCoverage, Readiness } from "./types";

const number = new Intl.NumberFormat("en-US");
const REFRESH_MS = 60 * 1000;

/** Format a quantity with a leading sign. */
function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${number.format(Math.abs(value))}`;
}

/** Short day label, e.g. "Sat 21 Nov", for an ISO date or datetime. */
function day(value: string | null): string {
  if (!value) return "–";
  const withTime = /\d{2}:\d{2}/.test(value);
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value.replace(" ", "T"));
  if (Number.isNaN(date.valueOf())) return value;
  const label = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return withTime ? `${label} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : label;
}

/** Drop the product line prefix: "Grand Heist 6 – Standard Edition (game card)" → "Standard Edition". */
function editionName(name: string): string {
  return name.split(/\s[–-]\s/).pop()?.replace(/\s*\(.*\)$/, "") ?? name;
}

/** Open notifications about this part or one of its shipments. */
function issuesFor(part: PartCoverage, notifications: Notification[]): Notification[] {
  const ids = [part.component_id, ...part.inbound.map((s) => s.shipment_id)].map((id) => id.toUpperCase());
  return notifications.filter(
    (n) => n.data.status !== "resolved" && ids.some((id) => (n.data.key ?? "").toUpperCase().includes(id)),
  );
}

type PartRow = PartCoverage & {
  issues: Notification[];
  tone: "muted" | "short" | "disputed" | "ok";
  [key: string]: unknown;
};

/** Launch readiness: packed per edition and whether part stock covers the rest (ERP view). */
export function ReadinessPanel({ notifications }: { notifications: Notification[] }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      getReadiness()
        .then((value) => {
          setData(value);
          setError("");
        })
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "Could not load readiness."),
        );
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const rows: PartRow[] = useMemo(() => {
    if (!data) return [];
    const priorities: Record<PartRow["tone"], number> = { short: 0, disputed: 1, ok: 2, muted: 3 };
    return data.parts.map((part) => {
      const issues = issuesFor(part, notifications);
      const disputed = part.balance >= 0 && issues.length > 0;
      const tone: PartRow["tone"] = part.fitted_into ? "muted" : part.balance < 0 ? "short" : disputed ? "disputed" : "ok";
      return { ...part, issues, tone };
    }).sort((a, b) => priorities[a.tone] - priorities[b.tone] || a.balance - b.balance);
  }, [data, notifications]);

  const columns: TableColumn<PartRow>[] = useMemo(
    () => [
      {
        key: "part",
        header: "Part",
        width: proportional(2, { minWidth: 220 }),
        renderCell: (part) => (
          <VStack gap={0}>
            <Text weight="semibold">{part.description}</Text>
            <Text type="supporting" color="secondary">
              {part.component_id}
              {part.critical ? " · critical" : ""}
              {part.suppliers.length ? ` · ${part.suppliers.join(", ")}` : ""}
            </Text>
          </VStack>
        ),
      },
      {
        key: "need",
        header: "Still needed",
        align: "end",
        renderCell: (part) =>
          part.fitted_into ? (
            <Text color="secondary">Fitted into {part.fitted_into}</Text>
          ) : (
            <Text hasTabularNumbers>{number.format(part.need)}</Text>
          ),
      },
      {
        key: "available",
        header: "Available",
        align: "end",
        renderCell: (part) =>
          part.fitted_into ? (
            <Text color="secondary">–</Text>
          ) : (
            <Text hasTabularNumbers>{number.format(part.available)}</Text>
          ),
      },
      {
        key: "balance",
        header: "Balance",
        align: "end",
        renderCell: (part) =>
          part.fitted_into ? (
            <Text color="secondary">–</Text>
          ) : (
            <VStack gap={0} hAlign="end">
              <HStack gap={2} vAlign="center">
                <StatusDot
                  variant={part.tone === "short" ? "error" : part.tone === "disputed" ? "warning" : "success"}
                  label={part.tone === "short" ? "shortage" : part.tone === "disputed" ? "evidence conflict" : "covered"}
                />
                <Text hasTabularNumbers weight="semibold">{signed(part.balance)}</Text>
              </HStack>
              {part.tone === "disputed" && (
                <Text type="supporting" color="secondary">
                  per ERP · disputed
                </Text>
              )}
            </VStack>
          ),
      },
      {
        key: "inbound",
        header: "Arriving before launch",
        width: proportional(2, { minWidth: 180 }),
        renderCell: (part) =>
          part.fitted_into ? (
            <Text color="secondary">not stocked separately</Text>
          ) : part.inbound.length ? (
            <VStack gap={1}>
              {part.inbound.map((s) => {
                const risk = s.status.includes("delay") || s.status.includes("hold");
                return (
                  <HStack key={s.shipment_id} gap={2} vAlign="center">
                    <StatusDot variant={risk ? "warning" : "accent"} label={s.status.replace(/_/g, " ")} />
                    <Text type="supporting">{s.mode} · {day(s.eta)} · {s.status.replace(/_/g, " ")}</Text>
                  </HStack>
                );
              })}
            </VStack>
          ) : (
            <Text color="secondary">none</Text>
          ),
      },
      {
        key: "issues",
        header: "Open issues",
        width: proportional(1.5, { minWidth: 160 }),
        renderCell: (part) =>
          part.issues.length ? (
            <Link href={`#n-${part.issues[0].id}`}>
              {part.issues[0].data.title}
              {part.issues.length > 1 ? ` +${part.issues.length - 1} more` : ""}
            </Link>
          ) : (
            <Text color="secondary">–</Text>
          ),
      },
    ],
    [],
  );

  if (error) {
    return <Banner status="error" title={`Launch readiness unavailable: ${error}`} />;
  }
  if (!data) {
    return <EmptyState title="Loading launch readiness…" isCompact />;
  }

  return (
    <Section padding={0}>
      <VStack gap={5}>
        <HStack gap={3} vAlign="end" wrap="wrap">
          <StackItem size="fill">
            <Heading level={2} id="ready-heading">
              Launch readiness
            </Heading>
          </StackItem>
          <Text type="supporting" color="secondary">
            ERP figures · stock as of {day(data.snapshot_date)}
          </Text>
        </HStack>

        <VStack gap={2}>
          <Heading level={3}>Packing progress</Heading>
          <List density="compact" hasDividers>
            {data.editions.map((edition) => {
              const pct = edition.day_one ? Math.min(100, (edition.packed / edition.day_one) * 100) : 0;
              return (
                <ListItem
                  key={edition.product_id}
                  label={editionName(edition.name)}
                  description={
                    <VStack gap={1}>
                      <ProgressBar
                        label={`${editionName(edition.name)} packed`}
                        isLabelHidden
                        value={pct}
                        hasValueLabel
                        formatValueLabel={() =>
                          `${number.format(edition.packed)} of ${number.format(edition.day_one)} packed (${pct.toFixed(0)}%)`
                        }
                        variant={pct >= 90 ? "success" : pct >= 50 ? "accent" : "warning"}
                      />
                      <Text type="supporting" color="secondary">
                        Updated {day(edition.last_packed)}
                        {edition.hours_left != null && edition.rate_per_hour
                          ? ` · approx. ${edition.hours_left} h at ${number.format(edition.rate_per_hour)}/h`
                          : ""}
                      </Text>
                    </VStack>
                  }
                  endContent={
                    <VStack gap={0} hAlign="end">
                      <Text size="lg" weight="bold" hasTabularNumbers>{number.format(edition.remaining)}</Text>
                      <Text type="supporting" color="secondary">left to pack</Text>
                    </VStack>
                  }
                />
              );
            })}
          </List>
        </VStack>

        <Table data={rows} columns={columns} idKey="component_id" density="compact" hasHover dividers="rows" />

        <Text type="supporting" color="secondary">
          Balance = ERP stock + receipts since the snapshot − what is still to pack. Shipment quantities are
          not in the ERP, so arrivals are listed but not counted. The ERP can be wrong: check the linked
          issues.
        </Text>
      </VStack>
    </Section>
  );
}
