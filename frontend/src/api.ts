import type { ImportResult, LaunchBrief } from "./types";

/** Make a typed request to the Linewatch API. */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const detail =
      typeof body === "object" && body !== null && "detail" in body
        ? String(body.detail)
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

/** Load the latest evidence-backed launch brief. */
export function getBrief(): Promise<LaunchBrief> {
  return request<LaunchBrief>("/api/launch");
}

/** Re-run prioritization after new data has arrived. */
export function runAgents(): Promise<LaunchBrief> {
  return request<LaunchBrief>("/api/agents/run", { method: "POST" });
}

/** Upload a portal archive as a new local snapshot. */
export function importArchive(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  return request<ImportResult>("/api/data/import", {
    method: "POST",
    body: form,
  });
}

/** Check the portal for files whose checksums changed. */
export function syncPortal(): Promise<ImportResult> {
  return request<ImportResult>("/api/data/sync", { method: "POST" });
}

/** Load a human-reviewable supplier follow-up draft. */
export function getSupplierDraft(edition: string): Promise<{
  to: string;
  subject: string;
  body: string;
}> {
  return request(`/api/supplier-draft?edition=${encodeURIComponent(edition)}`);
}
