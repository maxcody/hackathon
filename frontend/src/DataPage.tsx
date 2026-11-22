import { useEffect, useMemo, useState } from "react";
import { Layout, LayoutContent, LayoutPanel, HStack, VStack, StackItem } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Badge } from "@astryxdesign/core/Badge";
import { TextInput } from "@astryxdesign/core/TextInput";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { List, ListItem } from "@astryxdesign/core/List";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { Table, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { useTableSortable, useTableSortableState } from "@astryxdesign/core/Table";
import { getDataset, getLookups, listDatasets } from "./api";
import type { Dataset, DatasetColumn, DatasetInfo, Lookups, Notification } from "./types";

type Cell = string | number | null | undefined;
type Row = Record<string, Cell>;
/** A table view: which dataset, optionally filtered to rows whose column holds one id. */
interface View {
  key: string;
  filter?: { column: string; value: string; label: string };
}

type DataRow = {
  id: string;
  row: Row;
  issues: string[];
  [key: string]: unknown;
};

const number = new Intl.NumberFormat("en-US");
const CURRENCY: Record<string, string> = { EUR: "€", USD: "$", CNY: "¥", INR: "₹", KRW: "₩", PLN: "zł " };
/** Which dataset/column a linkable kind opens (mirrors app/dataset.py LINKS). */
const LINKS: Record<string, { dataset: string; column: string }> = {
  part: { dataset: "parts", column: "component_id" },
  supplier: { dataset: "suppliers", column: "supplier_id" },
  po: { dataset: "purchase_orders", column: "po_number" },
  shipment: { dataset: "shipments", column: "shipment_id" },
};
const STATUS_TONE: [RegExp, "error" | "success" | "neutral"][] = [
  [/delay|held|hold|reject|cancel|block|expired|awaiting|conditional/i, "error"],
  [/arrived|deliver|received|closed|complete|qualified|active|released|confirmed/i, "success"],
];

/** The ids in a cell; multi-value cells separate them with "|". */
function ids(value: Cell, multi: boolean): string[] {
  if (value == null || value === "") return [];
  const text = String(value);
  return multi ? text.split("|").map((v) => v.trim()).filter(Boolean) : [text];
}

/** "2026-11-21" or "2026-11-21 20:50" → "21 Nov 2026" / "21 Nov 2026, 20:50". */
function formatDate(value: Cell): string {
  if (value == null || value === "") return "";
  const text = String(value);
  const date = new Date(text.length === 10 ? `${text}T12:00:00` : text.replace(" ", "T"));
  if (Number.isNaN(date.valueOf())) return text;
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return /\d{2}:\d{2}/.test(text)
    ? `${day}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : day;
}

/** "2.10 EUR" → "€2.10". */
function formatMoney(value: Cell): string {
  const [amount, currency] = String(value ?? "").split(" ");
  if (!amount) return "";
  const n = Number(amount);
  const shown = Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : amount;
  return currency && CURRENCY[currency] ? `${CURRENCY[currency]}${shown}` : `${shown} ${currency ?? ""}`.trim();
}

/** Value used for sorting a column. */
function sortValue(value: Cell, kind: string): number | string {
  if (typeof value === "number") return value;
  if (kind === "money") return Number(String(value ?? "").split(" ")[0]) || 0;
  if (value == null || value === "") return kind === "balance" || kind === "qty" ? Number.POSITIVE_INFINITY : "";
  return String(value ?? "").toLowerCase();
}

/** Upper-case ids in open notification keys, without site codes. */
function issueIds(notifications: Notification[]): Set<string> {
  const found = new Set<string>();
  for (const n of notifications) {
    if (n.data.status === "resolved") continue;
    for (const part of (n.data.key ?? "").split(":").slice(1)) {
      if (part.length > 3 && !part.toUpperCase().startsWith("DC-")) found.add(part.toUpperCase());
    }
  }
  return found;
}

/** Open-issue ids in a row: only the row's own identifying columns count. */
function rowIssues(table: Dataset, row: Row, open: Set<string>): string[] {
  const identifying = new Set(["part", "po", "shipment", "delivery_note", "file"]);
  const first = table.columns[0];
  const found = new Set<string>();
  for (const column of table.columns) {
    if (column !== first && !identifying.has(column.kind)) continue;
    if (table.key === "parts" || table.key === "suppliers") {
      if (column !== first) continue;
    }
    for (const id of ids(row[column.key], column.multi)) {
      for (const token of id.toUpperCase().split(/[\s/_.]+/)) {
        if (open.has(token) && !(column.kind === "file" && token.startsWith("SUP-"))) found.add(token);
      }
    }
  }
  return [...found];
}

/** Data tab: the Soony data set as linked, formatted tables, with open issues marked. */
export function DataPage({ notifications }: { notifications: Notification[] }) {
  const [catalog, setCatalog] = useState<DatasetInfo[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ parts: {}, suppliers: {}, documents: {}, open_orders: [] });
  const openOrders = useMemo(() => new Set(lookups.open_orders), [lookups]);
  const [view, setView] = useState<View>(() => {
    try {
      const saved = window.localStorage.getItem("data-tab");
      return {
        key: saved && !["stock", "packed", "bom_changes", "documents"].includes(saved) ? saved : "parts",
      };
    } catch {
      return { key: "parts" };
    }
  });
  const [history, setHistory] = useState<View[]>([]);
  const [table, setTable] = useState<Dataset | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  useEffect(() => {
    listDatasets()
      .then(setCatalog)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load datasets."),
      );
    getLookups()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setTable(null);
    setError("");
    try {
      window.localStorage.setItem("data-tab", view.key);
    } catch {
      /* storage may be blocked */
    }
    getDataset(view.key)
      .then(setTable)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load the dataset."),
      );
  }, [view.key]);

  /** Open another table (optionally filtered), remembering where we came from. */
  function open(next: View) {
    setHistory((h) => [...h, view]);
    setQuery("");
    setOnlyIssues(false);
    setView(next);
  }
  function back() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setView(previous);
  }

  const open_ = useMemo(() => issueIds(notifications), [notifications]);

  const filteredRows: DataRow[] = useMemo(() => {
    if (!table) return [];
    const needle = query.trim().toLowerCase();
    let result = table.rows.map((row, index) => ({
      id: `${view.key}-${index}`,
      row,
      issues: rowIssues(table, row, open_),
    }));
    const filter = view.filter;
    if (filter) {
      result = result.filter(
        ({ row }) =>
          ids(row[filter.column], true).includes(filter.value) ||
          String(row[filter.column] ?? "") === filter.value,
      );
    }
    if (onlyIssues) result = result.filter((r) => r.issues.length > 0);
    if (needle) {
      result = result.filter(({ row }) =>
        table.columns.some((c) => {
          const value = row[c.key];
          if (value == null) return false;
          const named = ids(value, c.multi)
            .map((id) => lookups.parts[id] ?? lookups.suppliers[id] ?? "")
            .join(" ");
          return `${value} ${named}`.toLowerCase().includes(needle);
        }),
      );
    }
    return result;
  }, [table, view.filter, view.key, query, onlyIssues, open_, lookups]);

  const flagged = useMemo(
    () => (table ? table.rows.filter((row) => rowIssues(table, row, open_).length > 0).length : 0),
    [table, open_],
  );

  const comparators = useMemo(() => {
    if (!table) return {};
    const map: Record<string, (a: DataRow, b: DataRow) => number> = {};
    for (const column of table.columns) {
      map[column.key] = (a, b) => {
        const x = sortValue(a.row[column.key], column.kind);
        const y = sortValue(b.row[column.key], column.kind);
        return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      };
    }
    return map;
  }, [table]);

  const { sortedData, sortConfig } = useTableSortableState<DataRow>({
    data: filteredRows,
    comparators,
  });
  const sortPlugin = useTableSortable<DataRow>(sortConfig);

  /** One id as a link to its own table, with its name and any documents behind it. */
  function idLink(id: string, column: DatasetColumn) {
    const target = column.kind === "po" && !openOrders.has(id) ? undefined : LINKS[column.kind];
    const name =
      column.kind === "part" ? lookups.parts[id] : column.kind === "supplier" ? lookups.suppliers[id] : undefined;
    const docs = column.kind === "po" || column.kind === "delivery_note" ? lookups.documents[id] ?? [] : [];
    const label = column.kind === "supplier" && name ? name : id;
    const isSelf = target && target.dataset === view.key && target.column === column.key;
    return (
      <VStack key={id} gap={0}>
        {target && !isSelf ? (
          <Button
            label={label}
            variant="ghost"
            size="sm"
            onClick={() =>
              open({
                key: target.dataset,
                filter: { column: target.column, value: id, label: name ? `${id} · ${name}` : id },
              })
            }
          />
        ) : (
          <Text weight={column.kind === "supplier" ? "semibold" : "normal"}>{label}</Text>
        )}
        {column.kind === "part" && name && (
          <Text type="supporting" color="secondary">
            {name}
          </Text>
        )}
        {column.kind === "supplier" && name && (
          <Text type="supporting" color="secondary">
            {id}
          </Text>
        )}
        {docs.map((path) => (
          <Link key={path} href={`/dataset/file?path=${encodeURIComponent(path)}`} isExternalLink>
            {path.split("/").pop()}
          </Link>
        ))}
      </VStack>
    );
  }

  /** Render one cell according to its column kind. */
  function renderCell(item: DataRow, column: DatasetColumn) {
    const value = item.row[column.key];
    if (value == null || value === "") return <Text color="secondary">–</Text>;
    switch (column.kind) {
      case "balance": {
        const n = Number(value);
        return (
          <Text hasTabularNumbers weight="semibold" color={n < 0 ? "accent" : "primary"}>
            {n > 0 ? "+" : n < 0 ? "−" : ""}
            {number.format(Math.abs(n))}
          </Text>
        );
      }
      case "qty":
        return (
          <Text hasTabularNumbers>
            {typeof value === "number" ? number.format(value) : value}
          </Text>
        );
      case "money":
        return <Text hasTabularNumbers>{formatMoney(value)}</Text>;
      case "date":
        return <Text>{formatDate(value)}</Text>;
      case "flag":
        return value === "Y" ? (
          <Badge label="Yes" variant="info" />
        ) : value === "N" ? (
          <Text color="secondary">No</Text>
        ) : (
          <Text>{String(value)}</Text>
        );
      case "status": {
        const text = String(value).replace(/_/g, " ");
        const tone = STATUS_TONE.find(([pattern]) => pattern.test(text))?.[1] ?? "neutral";
        return <Badge label={text} variant={tone} />;
      }
      case "file": {
        const path = String(value);
        return (
          <Link href={`/dataset/file?path=${encodeURIComponent(path)}`} isExternalLink>
            <VStack gap={0}>
              <Text weight="semibold">{path.split("/").pop()}</Text>
              <Text type="supporting" color="secondary">
                {path.split("/").slice(0, -1).join(" / ")}
              </Text>
            </VStack>
          </Link>
        );
      }
      case "part":
      case "supplier":
      case "po":
      case "shipment":
      case "delivery_note":
        return (
          <HStack gap={2} wrap="wrap">
            {ids(value, column.multi).map((id) => idLink(id, column))}
          </HStack>
        );
      default:
        return <Text>{String(value)}</Text>;
    }
  }

  const columns: TableColumn<DataRow>[] = useMemo(() => {
    if (!table) return [];
    const cols: TableColumn<DataRow>[] = table.columns.map((column) => ({
      key: column.key,
      header: column.label,
      align: ["qty", "money", "balance"].includes(column.kind) ? "end" : "start",
      width: proportional(1, { minWidth: 120 }),
      renderCell: (item) => renderCell(item, column),
    }));
    if (table.related.length > 0) {
      cols.push({
        key: "related",
        header: "Related",
        renderCell: (item) => (
          <HStack gap={1} wrap="wrap">
            {table.related.map((r) => {
              const id = String(item.row[r.value_from] ?? "");
              const name = lookups.parts[id] ?? lookups.suppliers[id];
              return id ? (
                <Button
                  key={r.label}
                  label={r.label}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    open({
                      key: r.dataset,
                      filter: { column: r.column, value: id, label: name ? `${id} · ${name}` : id },
                    })
                  }
                />
              ) : null;
            })}
          </HStack>
        ),
      });
    }
    cols.push({
      key: "issues",
      header: "Issues",
      renderCell: (item) =>
        item.issues.length ? (
          <Badge label={item.issues.join(", ")} variant="warning" />
        ) : (
          <Text color="secondary">–</Text>
        ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, lookups, view.key, openOrders]);

  return (
    <Layout
      height="fill"
      header={
        <VStack gap={1} padding={4} paddingBlockEnd={0}>
          <Heading level={1}>Data</Heading>
          <Text color="secondary">
            What you need to run and watch the supply chain · click an id to jump to its table · rows with an
            open issue are marked
          </Text>
        </VStack>
      }
      start={
        <LayoutPanel width={260} hasDivider label="Datasets" padding={2}>
          <List density="compact" edge="flush">
            {catalog.map((d) => (
              <ListItem
                key={d.key}
                label={d.title}
                description={d.description}
                isSelected={d.key === view.key}
                onClick={() => {
                  setHistory([]);
                  setQuery("");
                  setView({ key: d.key });
                }}
              />
            ))}
          </List>
        </LayoutPanel>
      }
      content={
        <LayoutContent role="main" id="data" padding={0}>
          <VStack gap={4} padding={4}>
            {error && <Banner status="error" title={error} />}
            {!table && !error && <EmptyState title="Loading…" isCompact />}
            {table && (
              <>
                <HStack gap={3} vAlign="center" wrap="wrap">
                  {history.length > 0 && (
                    <Button label="← Back" variant="secondary" size="sm" onClick={back} />
                  )}
                  <StackItem size="fill">
                    <VStack gap={0}>
                      <Heading level={2}>{table.title}</Heading>
                      <Text type="supporting" color="secondary">
                        {filteredRows.length === table.rows.length
                          ? `${number.format(table.rows.length)} rows`
                          : `${number.format(filteredRows.length)} of ${number.format(table.rows.length)} rows`}{" "}
                        · {table.source}
                      </Text>
                    </VStack>
                  </StackItem>
                  {view.filter && (
                    <Badge
                      label={`${table.columns.find((c) => c.key === view.filter?.column)?.label ?? view.filter.column}: ${view.filter.label}`}
                      variant="info"
                    />
                  )}
                  {view.filter && (
                    <Button
                      label="Clear filter"
                      variant="ghost"
                      size="sm"
                      onClick={() => setView({ key: view.key })}
                    />
                  )}
                  <CheckboxInput
                    label={`Open issues only (${flagged})`}
                    value={onlyIssues}
                    onChange={setOnlyIssues}
                  />
                  <StackItem size="fill">
                    <TextInput
                      label="Search this table"
                      isLabelHidden
                      type="search"
                      placeholder="Search this table"
                      value={query}
                      onChange={setQuery}
                      startIcon="search"
                      hasClear
                    />
                  </StackItem>
                </HStack>

                <Table
                  data={sortedData.slice(0, 500)}
                  columns={columns}
                  idKey="id"
                  density="compact"
                  hasHover
                  plugins={{ sort: sortPlugin }}
                  emptyState={<EmptyState title="No rows match." isCompact />}
                />
                {filteredRows.length > 500 && (
                  <Text type="supporting" color="secondary">
                    Showing the first 500 rows; search, filter or sort to narrow down.
                  </Text>
                )}
              </>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
