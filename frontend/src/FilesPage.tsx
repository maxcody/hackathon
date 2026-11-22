import { useEffect, useMemo, useState } from "react";
import { Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { listFiles } from "./api";
import { localTime } from "./time";
import type { DataFile } from "./types";

type FileRow = DataFile & { id: string; [key: string]: unknown };

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const COLUMNS: TableColumn<FileRow>[] = [
  {
    key: "name",
    header: "File",
    width: proportional(2, { minWidth: 220 }),
    renderCell: (row) => (
      <Link href={`/dataset/file?path=${encodeURIComponent(row.path)}`} isExternalLink>
        {row.name}
      </Link>
    ),
  },
  {
    key: "folder",
    header: "Folder",
    width: proportional(3, { minWidth: 200 }),
    renderCell: (row) => <Text color="secondary">{row.folder || "/"}</Text>,
  },
  { key: "size", header: "Size", width: pixel(90), renderCell: (row) => <Text hasTabularNumbers>{size(row.size)}</Text> },
  { key: "modified", header: "Modified", width: pixel(160), renderCell: (row) => <Text>{localTime(row.modified)}</Text> },
];

/** Every file in the data folder; click one to open it in the browser. */
export function FilesPage() {
  const [files, setFiles] = useState<DataFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listFiles()
      .then(setFiles)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the files."));
  }, []);

  const rows = useMemo<FileRow[]>(() => {
    const q = query.trim().toLowerCase();
    return (files ?? [])
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .map((f) => ({ ...f, id: f.path }));
  }, [files, query]);

  return (
    <Layout
      height="fill"
      header={
        <VStack gap={1} padding={4} paddingBlockEnd={0}>
          <Heading level={1}>Files</Heading>
          <Text color="secondary">
            {files ? `${files.length} files` : "The files"} in the data folder · click one to open it
          </Text>
        </VStack>
      }
    >
      <LayoutContent role="main" id="files" padding={0}>
        <VStack gap={3} padding={4}>
          {error && <Banner status="error" title={error} />}
          {!files && !error && <EmptyState title="Loading…" isCompact />}
          {files && (
            <>
              <TextInput label="Search files" isLabelHidden placeholder="Search" value={query} onChange={setQuery} />
              <Table
                data={rows}
                columns={COLUMNS}
                idKey="id"
                density="compact"
                hasHover
                emptyState={<EmptyState title="No files match." isCompact />}
              />
            </>
          )}
        </VStack>
      </LayoutContent>
    </Layout>
  );
}
