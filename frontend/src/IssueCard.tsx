import { Fragment } from "react";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import type { Fact } from "./types";

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
