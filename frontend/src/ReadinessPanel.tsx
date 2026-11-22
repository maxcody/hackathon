import { useEffect, useMemo, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Link } from "@astryxdesign/core/Link";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Table, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Grid } from "@astryxdesign/core/Grid";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { getReadiness } from "./api";
import { CoverageChart } from "./CoverageChart";
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
    return data.parts.map((part) => {
      const issues = issuesFor(part, notifications);
      const disputed = part.balance >= 0 && issues.length > 0;
      const tone = part.fitted_into ? "muted" : part.balance < 0 ? "short" : disputed ? "disputed" : "ok";
      return { ...part, issues, tone };
    });
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
              <Text
                hasTabularNumbers
                weight="semibold"
                color={part.tone === "short" ? "inherit" : "primary"}
                style={part.tone === "short" ? { color: "var(--color-error)" } : undefined}
              >
                {signed(part.balance)}
              </Text>
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
              {part.inbound.map((s) => (
                <Badge
                  key={s.shipment_id}
                  label={`${s.mode} · ${day(s.eta)} · ${s.status.replace(/_/g, " ")}`}
                  variant={s.status.includes("delay") || s.status.includes("hold") ? "warning" : "neutral"}
                />
              ))}
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

        <Grid columns={{ minWidth: 240, max: Math.max(1, data.editions.length) }} gap={3}>
          {data.editions.map((edition) => {
            const pct = edition.day_one ? Math.min(100, (edition.packed / edition.day_one) * 100) : 0;
            return (
              <Card key={edition.product_id} padding={4}>
                <VStack gap={3}>
                  <Text weight="semibold">{editionName(edition.name)}</Text>
                  <HStack gap={1} vAlign="end">
                    <Text size="xl" weight="bold" hasTabularNumbers>
                      {number.format(edition.remaining)}
                    </Text>
                    <Text type="supporting" color="secondary">
                      still to pack
                    </Text>
                  </HStack>
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
                    as of {day(edition.last_packed)}
                  </Text>
                  {edition.hours_left != null && edition.rate_per_hour ? (
                    <Text type="supporting" color="secondary">
                      ≈ {edition.hours_left} h of packing at {number.format(edition.rate_per_hour)}/h
                    </Text>
                  ) : null}
                </VStack>
              </Card>
            );
          })}
        </Grid>

        <CoverageChart parts={data.parts} />

        <Collapsible trigger={<Text weight="medium">Part details</Text>} defaultIsOpen={false}>
          <Table data={rows} columns={columns} idKey="component_id" density="compact" hasHover dividers="rows" />
        </Collapsible>

        <Text type="supporting" color="secondary">
          Balance = ERP stock + receipts since the snapshot − what is still to pack. Shipment quantities are
          not in the ERP, so arrivals are listed but not counted. The ERP can be wrong: check the linked
          issues.
        </Text>
      </VStack>
    </Section>
  );
}
