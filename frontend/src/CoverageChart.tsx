import { Card } from "@astryxdesign/core/Card";
import { Heading, Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import type { PartCoverage } from "./types";

const number = new Intl.NumberFormat("en-US");

/** Percent difference of available stock against what is needed, e.g. "−84%" or "+537%". */
function difference(part: PartCoverage): string {
  if (!part.need) return "–";
  const pct = Math.round(((part.available - part.need) / part.need) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

/**
 * Needed against available per part: the bar fills to the share of the need that is covered,
 * the number on the right is the difference in percent. Worst covered parts come first.
 */
export function CoverageChart({ parts }: { parts: PartCoverage[] }) {
  const rows = parts
    .filter((part) => part.need > 0)
    .sort((a, b) => a.available / a.need - b.available / b.need);
  if (!rows.length) return null;

  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <Heading level={3}>Needed vs available</Heading>
          <HStack gap={4} vAlign="center">
            <Legend color="var(--color-accent)" label="Covered" />
            <Legend color="var(--color-error)" label="Short" />
            <Legend color="var(--chart-track)" label="Needed" />
          </HStack>
        </HStack>
        <div className="coverage">
          {rows.map((part) => {
            const covered = Math.min(1, part.available / part.need);
            const short = part.available < part.need;
            return (
              <div
                className="coverage-row"
                key={part.component_id}
                title={`${part.description}: ${number.format(part.available)} available of ${number.format(part.need)} needed`}
              >
                <Text maxLines={1}>{part.description}</Text>
                <div
                  className="coverage-track"
                  role="img"
                  aria-label={`${Math.round(covered * 100)}% of the need covered`}
                >
                  <div
                    className="coverage-fill"
                    style={{
                      width: `${covered * 100}%`,
                      background: short ? "var(--color-error)" : "var(--color-accent)",
                    }}
                  />
                </div>
                <Text color="secondary" hasTabularNumbers>
                  {number.format(part.available)} / {number.format(part.need)}
                </Text>
                <Text
                  weight="medium"
                  hasTabularNumbers
                  color={short ? "inherit" : "secondary"}
                  style={short ? { color: "var(--color-error)" } : undefined}
                >
                  {difference(part)}
                </Text>
              </div>
            );
          })}
        </div>
      </VStack>
    </Card>
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
