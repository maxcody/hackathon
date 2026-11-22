import { useEffect, useMemo, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack, StackItem } from "@astryxdesign/core/Layout";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { getReadiness } from "./api";
import { Button } from "@astryxdesign/core/Button";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { severityDot, severityOf, sortIssues } from "./issues";
import type { Edition, Notification, PartCoverage, Readiness } from "./types";

const number = new Intl.NumberFormat("en-US");
const REFRESH_MS = 60 * 1000;

/** Format a quantity with a leading sign. */
export function signed(value: number): string {
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
  return sortIssues(
    notifications.filter(
      (n) => n.data.status !== "resolved" && ids.some((id) => (n.data.key ?? "").toUpperCase().includes(id)),
    ),
  );
}

type Tone = "short" | "disputed" | "ok" | "muted";
type PartRow = PartCoverage & { issues: Notification[]; tone: Tone };

const TONE: Record<Tone, { label: string; rank: number }> = {
  short: { label: "Missing", rank: 0 },
  disputed: { label: "At risk", rank: 1 },
  ok: { label: "Covered", rank: 2 },
  muted: { label: "Supplied inside another part", rank: 3 },
};

/**
 * One part as a bar: the track is what is still needed, the fill what is
 * available (capped at the need), the hatched rest what is missing.
 */
function CoverageBar({ part, anchor }: { part: PartRow; anchor?: string }) {
  const covered = part.need ? Math.min(1, part.available / part.need) : 1;
  const tone = TONE[part.tone];
  const summary =
    part.tone === "short"
      ? `${number.format(part.available)} of ${number.format(part.need)} · ${number.format(-part.balance)} missing`
      : `${number.format(part.need)} needed · ${number.format(part.available)} in stock${part.tone === "disputed" ? " per ERP" : ""}`;
  return (
    <div className={`cov-row cov-${part.tone}`} id={anchor}>
      <div className="cov-head">
        <div className="cov-name">
          <Text weight="semibold">{part.description}</Text>
          <Text type="supporting" color="secondary">
            {part.component_id}
            {part.critical ? " · critical" : ""}
            {part.suppliers.length ? ` · ${part.suppliers.join(", ")}` : ""}
          </Text>
        </div>
        <span className="cov-tag">{tone.label}</span>
        {part.issues.length > 0 && (
          <Button
            label={part.issues.length > 1 ? `Open issues (${part.issues.length})` : "Open issue"}
            variant="secondary"
            size="sm"
            href={`#n-${part.issues[0].id}`}
          />
        )}
      </div>
      <div
        className="cov-track"
        role="img"
        aria-label={`${part.description}: ${tone.label}, ${summary}`}
        title={summary}
      >
        <div className="cov-fill" style={{ width: `${covered * 100}%` }} />
        {covered < 1 && <div className="cov-gap" style={{ width: `${(1 - covered) * 100}%` }} />}
      </div>
      <div className="cov-foot">
        <Text type="supporting" hasTabularNumbers>{summary}</Text>
        {part.inbound.map((s) => (
          <Badge
            key={s.shipment_id}
            label={`${s.mode} · ${day(s.eta)} · ${s.status.replace(/_/g, " ")}`}
            variant={s.status.includes("delay") || s.status.includes("hold") ? "warning" : "neutral"}
          />
        ))}
      </div>
      {/* Every open issue about this part, most severe first; each opens its issue page */}
      {part.issues.length > 0 && (
        <div className="cov-issues">
          {part.issues.map((issue) => (
            <a key={issue.id} className="cov-issue" href={`#n-${issue.id}`}>
              <StatusDot variant={severityDot(severityOf(issue))} label={severityOf(issue)} />
              <span>{issue.data.title || issue.attr}</span>
              <span aria-hidden>→</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Remaining packs of one edition by what the parts allow. */
interface EditionSplit {
  edition: Edition;
  ready: number; // every part covered and undisputed
  atRisk: number; // packable per ERP, but a part's stock is disputed by an open issue
  blocked: number; // a part is missing
  blockers: { part: PartRow; short: number }[];
  disputed: PartRow[];
}

/**
 * Split each edition's remaining packs into ready, at risk and blocked.
 *
 * Shared parts (e.g. game cards) go to the Collector's Edition first, as the CPO
 * memo says; a part's need per pack is its total need over the packs that use it.
 */
function splitEditions(editions: Edition[], parts: PartRow[]): EditionSplit[] {
  const counted = parts.filter((p) => !p.fitted_into);
  const remainingOf = new Map(editions.map((e) => [e.product_id, e.remaining]));
  const perPack = new Map(
    counted.map((p) => {
      const packs = p.used_in.reduce((sum, id) => sum + (remainingOf.get(id) ?? 0), 0);
      return [p.component_id, packs ? p.need / packs : 1];
    }),
  );
  const pool = new Map(counted.map((p) => [p.component_id, Math.max(0, p.available)]));
  const order = [...editions].sort((a, b) => Number(/collector/i.test(b.name)) - Number(/collector/i.test(a.name)));
  const splits = new Map<string, EditionSplit>();
  for (const edition of order) {
    const used = counted.filter((p) => p.used_in.includes(edition.product_id));
    const capacity = (p: PartRow) => Math.floor((pool.get(p.component_id) ?? 0) / (perPack.get(p.component_id) ?? 1));
    const packable = Math.min(edition.remaining, ...used.map(capacity));
    const blockers = used
      .filter((p) => capacity(p) < edition.remaining)
      .map((p) => ({ part: p, short: edition.remaining - capacity(p) }))
      .sort((a, b) => b.short - a.short);
    for (const p of used) pool.set(p.component_id, (pool.get(p.component_id) ?? 0) - packable * (perPack.get(p.component_id) ?? 1));
    const disputed = used.filter((p) => p.tone === "disputed");
    const atRisk = disputed.length ? packable : 0;
    splits.set(edition.product_id, { edition, ready: packable - atRisk, atRisk, blocked: edition.remaining - packable, blockers, disputed });
  }
  return editions.map((e) => splits.get(e.product_id)!);
}

/** One edition: packs still to pack, split into ready / at risk / blocked, with the reasons. */
function EditionCard({ split }: { split: EditionSplit }) {
  const { edition, ready, atRisk, blocked } = split;
  const pct = edition.day_one ? Math.min(100, (edition.packed / edition.day_one) * 100) : 0;
  const segments = [
    { tone: "short", value: blocked, label: "blocked" },
    { tone: "disputed", value: atRisk, label: "at risk" },
    { tone: "ok", value: ready, label: "ready" },
  ].filter((s) => s.value > 0);
  return (
    <Card padding={5}>
      <VStack gap={4}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Text weight="semibold">{editionName(edition.name)}</Text>
          </StackItem>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {pct.toFixed(0)}% packed
          </Text>
        </HStack>
        <HStack gap={1} vAlign="end">
          <Text size="xl" weight="bold" hasTabularNumbers>
            {number.format(edition.remaining)}
          </Text>
          <Text type="supporting" color="secondary">packs still to pack</Text>
        </HStack>
        <div
          className="ed-bar"
          role="img"
          aria-label={segments.map((s) => `${number.format(s.value)} ${s.label}`).join(", ")}
        >
          {segments.map((s) => (
            <div key={s.tone} className={`ed-seg cov-${s.tone}`} style={{ flexGrow: s.value }} />
          ))}
        </div>
        <div className="ed-rows">
          <div className="ed-row cov-short">
            <span className="cov-swatch" aria-hidden />
            <strong>{number.format(blocked)}</strong>
            <span>blocked</span>
          </div>
          <div className="ed-row cov-disputed">
            <span className="cov-swatch" aria-hidden />
            <strong>{number.format(atRisk)}</strong>
            <span>at risk</span>
          </div>
          <div className="ed-row cov-ok">
            <span className="cov-swatch" aria-hidden />
            <strong>{number.format(ready)}</strong>
            <span>ready to pack</span>
          </div>
        </div>
        <Text type="supporting" color="secondary">
          {number.format(edition.packed)} of {number.format(edition.day_one)} packed as of {day(edition.last_packed)}
          {edition.hours_left != null && edition.rate_per_hour
            ? ` · ≈ ${edition.hours_left} h of packing at ${number.format(edition.rate_per_hour)}/h`
            : ""}
        </Text>
      </VStack>
    </Card>
  );
}

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
      return { ...part, issues, tone: tone as Tone };
    })
      // Most urgent first: missing (largest gap first), then at risk, then covered
      .sort((a, b) => TONE[a.tone].rank - TONE[b.tone].rank || a.balance - b.balance);
  }, [data, notifications]);

  if (error) {
    return <Banner status="error" title={`Launch readiness unavailable: ${error}`} />;
  }
  if (!data) {
    return <EmptyState title="Loading launch readiness…" isCompact />;
  }

  const counted = rows.filter((r) => r.tone !== "muted");
  const byTone = (tone: Tone) => counted.filter((r) => r.tone === tone);

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

        <Grid columns={{ minWidth: 280, max: Math.max(1, data.editions.length) }} gap={3}>
          {splitEditions(data.editions, rows).map((split) => (
            <EditionCard key={split.edition.product_id} split={split} />
          ))}
        </Grid>

        <VStack gap={3}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <Heading level={3}>Parts for the remaining packs</Heading>
            </StackItem>
            {(["short", "disputed", "ok"] as const).map((tone) => (
              <span key={tone} className={`cov-count cov-${tone}`}>
                <span className="cov-swatch" aria-hidden />
                {byTone(tone).length} {TONE[tone].label.toLowerCase()}
              </span>
            ))}
          </HStack>
          <Card padding={0}>
            <div className="cov-list">
              {counted.map((part, index) => (
                <CoverageBar key={part.component_id} part={part} anchor={counted[index - 1]?.tone !== part.tone ? `cov-${part.tone}` : undefined} />
              ))}
            </div>
          </Card>
          {rows.some((r) => r.tone === "muted") && (
            <Text type="supporting" color="secondary">
              Not counted:{" "}
              {rows
                .filter((r) => r.tone === "muted")
                .map((r) => `${r.description} (supplied inside ${r.fitted_into})`)
                .join(", ")}
              .
            </Text>
          )}
          <Text type="supporting" color="secondary">
            Bar = what the remaining packs still need; filled = available (ERP stock + receipts since the
            snapshot); hatched = missing. Shipments are listed but not counted, because their quantities are
            not in the ERP. "At risk" means the ERP shows enough, but an open issue disputes it.
          </Text>
        </VStack>
      </VStack>
    </Section>
  );
}
