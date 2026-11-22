import { Fragment } from "react";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import type { Fact, Notification } from "./types";

/**
 * Text where **double asterisks** mark the facts to stand out: they take the
 * primary text color and a medium weight, so the surrounding text should be secondary.
 *
 * @param text - Plain text, as an agent wrote it.
 */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
        index % 2 ? (
          <Text key={index} as="span" color="primary" weight="medium">
            {part}
          </Text>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The key figures of an issue: a small label above a large value.
 *
 * @param facts - Label and value pairs, in display order.
 */
export function FactGrid({ facts }: { facts: Fact[] }) {
  return (
    <HStack gap={6} wrap="wrap">
      {facts.map((fact) => (
        <VStack key={fact.label} gap={0}>
          <Text type="supporting" color="secondary">
            {fact.label}
          </Text>
          <Text size="xl" weight="medium" hasTabularNumbers>
            {fact.value}
          </Text>
        </VStack>
      ))}
    </HStack>
  );
}

/**
 * The files that back an issue, one per line; each opens in a new tab.
 *
 * @param paths - Data-folder paths; duplicates are shown once.
 */
export function SourceFiles({ paths }: { paths: string[] }) {
  const unique = [...new Set(paths)];
  if (!unique.length) return null;
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">
        Source
      </Text>
      {unique.map((path) => (
        <Link key={path} href={`/dataset/file?path=${encodeURIComponent(path)}`} isExternalLink>
          {path}
        </Link>
      ))}
    </VStack>
  );
}

/** A plain quantity such as "46,000" or "~12 000 pcs"; dates, times and money amounts give null. */
function quantity(value: string | null | undefined): number | null {
  const match = (value ?? "").trim().match(/^[~≈]?\s*(\d[\d,. ]*)(?:\s+[A-Za-z]+)?$/);
  if (!match || /:/.test(value ?? "")) return null;
  const number = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

export interface Measured {
  expected: number;
  actual: number;
  /** Actual against expected in percent, e.g. -64. */
  pct: number;
}

/**
 * The expected and actual quantity of an issue, from its key figures (needed against in stock,
 * or against missing), else from the ERP and actual values. Null when the numbers are not plain quantities.
 */
export function measured(n: Notification): Measured | null {
  const find = (re: RegExp) => (n.data.facts ?? []).find((f) => re.test(f.label) && quantity(f.value) !== null);
  const need = find(/need|expected qty|required|ordered|booked|erp/i);
  const have = find(/in stock|available|actual|received|delivered|on hand/i);
  const missing = find(/missing|short/i);
  let expected = need ? quantity(need.value) : null;
  let actual = have ? quantity(have.value) : null;
  if (expected !== null && actual === null && missing) actual = expected - (quantity(missing.value) ?? 0);
  if (expected === null || actual === null) {
    expected = quantity(n.erp_val);
    actual = quantity(n.customer_val);
  }
  if (!expected || actual === null) return null;
  return { expected, actual, pct: Math.round(((actual - expected) / expected) * 100) };
}

const number = new Intl.NumberFormat("en-US");

/** "−84%" / "+19%". */
export function signedPct(pct: number): string {
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

/**
 * Bar of actual against expected with the difference in percent.
 *
 * @param compact - Only the bar and the percent, for the small card.
 */
export function ComparisonBar({ n, compact = false }: { n: Notification; compact?: boolean }) {
  const m = measured(n);
  if (!m) return null;
  const short = m.actual < m.expected;
  const share = Math.min(1, Math.max(0, m.actual / m.expected));
  const bar = (
    <div className="coverage-track" role="img" aria-label={`${Math.round(share * 100)}% of expected`}>
      <div
        className="coverage-fill"
        style={{ width: `${share * 100}%`, background: short ? "var(--color-error)" : "var(--color-accent)" }}
      />
    </div>
  );
  const pct = (
    <Text weight="medium" hasTabularNumbers style={short ? { color: "var(--color-error)" } : undefined}>
      {signedPct(m.pct)}
    </Text>
  );
  if (compact)
    return (
      <HStack gap={3} vAlign="center">
        <div style={{ flex: 1 }}>{bar}</div>
        {pct}
      </HStack>
    );
  return (
    <VStack gap={2}>
      {bar}
      <HStack gap={3} vAlign="center">
        <Text color="secondary" hasTabularNumbers>
          {number.format(m.actual)} actual of {number.format(m.expected)} expected
        </Text>
        {pct}
      </HStack>
    </VStack>
  );
}
