/** The HTTP method used by a backend request. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** One API call and its unmodified response body. */
export interface ApiCallResult {
  id: string;
  method: HttpMethod;
  path: string;
  status: number;
  statusText: string;
  durationMs: number;
  ok: boolean;
  body: unknown;
  at: string;
}

/** The launch status assembled by the backend from ERP and delivery notes. */
export interface Readiness {
  deadline: string;
  verdict: string;
  remaining_units: Record<string, number>;
  stock_corrections: Array<{ part: string; delivery_note: string; delta: number }>;
  parts: PartReadiness[];
}

/** Stock and inbound coverage for one component. */
export interface PartReadiness {
  part: string;
  description: string;
  need: number;
  stock: number;
  inbound: number;
  late_inbound: number;
  gap: number;
  cover: number;
  status: "ok" | "tight" | "short" | string;
  notes: string[];
}

/** A risk or discrepancy found by the backend pipeline. */
export interface Finding {
  id: number;
  kind: string;
  severity: "critical" | "warning" | "info" | string;
  title: string;
  detail: string;
  part: string | null;
  status: "open" | "acknowledged" | "resolved" | string;
  source_path: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/** A portal file tracked by checksum and processing status. */
export interface SourceFile {
  id: number;
  path: string;
  sha256: string;
  size_bytes: number;
  parser_version: number;
  status: "pending" | "processed" | "failed" | "removed" | string;
  error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A tracked file plus the data extracted from its scan. */
export interface SourceFileDetail extends SourceFile {
  extracted: Record<string, unknown> | null;
}

/** A finished product in the master catalog. */
export interface Product {
  product_id: string;
  name: string;
  product_line: string;
  lifecycle: string;
  launch_date: string;
  weekly_plan_qty: number;
  day_one_qty: number | null;
  plants: string;
  std_cost_eur: string | number;
}

/** A bill-of-material line returned with product detail. */
export interface BomLine {
  child_id: string;
  qty_per: number;
  valid_from: string;
  valid_to: string;
}

/** A product including its current bill of materials. */
export interface ProductDetail extends Product {
  bom: BomLine[];
}

/** A component in the master catalog. */
export interface Component {
  component_id: string;
  description: string;
  category: string;
  uom: string;
  abc_class: string;
  critical: boolean;
  drawing_rev: string;
}

/** An engineering change that affects a product BOM. */
export interface BomChange {
  change_id: string;
  parent_id: string;
  child_id: string;
  action: string;
  qty_per_old: number;
  qty_per_new: number;
  rev_old: string;
  rev_new: string;
  use_up_old_rev: boolean;
  effective_from: string;
  reason: string;
}

/** Outcome returned by the portal sync endpoint. */
export interface SyncSummary {
  added: string[];
  changed: string[];
  failed: string[];
  unchanged: number;
}

/** Outcome returned by the end-to-end pipeline endpoint. */
export interface PipelineSummary {
  downloaded: number;
  files_tracked: number;
  scans_read: number;
  scans_failed: number;
  findings_open: number;
}
