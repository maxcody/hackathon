import { Card } from "@astryxdesign/core/Card";
import { Heading, Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import type { Edition, PartCoverage } from "./types";

const number = new Intl.NumberFormat("en-US");

interface Row {
  id: string;
  label: string;
  expected: number;
  actual: number;
  /** Red when the actual number falls short of the expected one; editions in progress are not flagged. */
  flagShort: boolean;
}

/** Percent difference of actual against expected, e.g. "−84%" or "+537%". */
function difference(row: Row): string {
  const pct = Math.round(((row.actual - row.expected) / row.expected) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

function editionLabel(name: string): string {
  return name.split(/\s[–-]\s/).pop()?.replace(/\s*\(.*\)$/, "") ?? name;
}

/**
 * Expected against actual, with the difference in percent: packed against the day-one target per
 * edition, and available stock against the need per part (worst covered first).
 */
export function CoverageChart({ editions, parts }: { editions: Edition[]; parts: PartCoverage[] }) {
  const editionRows: Row[] = editions
    .filter((e) => e.day_one > 0)
    .map((e) => ({ id: e.product_id, label: editionLabel(e.name), expected: e.day_one, actual: e.packed, flagShort: false }));
  const partRows: Row[] = parts
    .filter((p) => p.need > 0)
    .map((p) => ({ id: p.component_id, label: p.description, expected: p.need, actual: p.available, flagShort: true }))
    .sort((a, b) => a.actual / a.expected - b.actual / b.expected);
  if (!editionRows.length && !partRows.length) return null;

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <Heading level={3}>Expected vs actual</Heading>
          <HStack gap={4} vAlign="center">
            <Legend color="var(--color-accent)" label="Actual" />
            <Legend color="var(--color-error)" label="Short of expected" />
            <Legend color="var(--chart-track)" label="Expected" />
          </HStack>
        </HStack>
        <Group title="Packed against the day-one target" rows={editionRows} />
        <Group title="Stock against what the remaining packs need" rows={partRows} />
      </VStack>
    </Card>
  );
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">
        {title}
      </Text>
      <div className="coverage">
        {rows.map((row) => {
          const share = Math.min(1, row.actual / row.expected);
          const short = row.flagShort && row.actual < row.expected;
          return (
            <div
              className="coverage-row"
              key={row.id}
              title={`${row.label}: ${number.format(row.actual)} actual of ${number.format(row.expected)} expected`}
            >
              <Text maxLines={1}>{row.label}</Text>
              <div className="coverage-track" role="img" aria-label={`${Math.round(share * 100)}% of expected`}>
                <div
                  className="coverage-fill"
                  style={{ width: `${share * 100}%`, background: short ? "var(--color-error)" : "var(--color-accent)" }}
                />
              </div>
              <Text color="secondary" hasTabularNumbers>
                {number.format(row.actual)} / {number.format(row.expected)}
              </Text>
              <Text
                weight="medium"
                hasTabularNumbers
                color={short ? "inherit" : "secondary"}
                style={short ? { color: "var(--color-error)" } : undefined}
              >
                {difference(row)}
              </Text>
            </div>
          );
        })}
      </div>
    </VStack>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <HStack gap={1} vAlign="center">
      <span className="legend-swatch" style={{ background: color }} />
      <Text type="supporting" color="secondary">
        {label}
      </Text>
    </HStack>
  );
}
