/** A risk level returned by launch analysis. */
export type Severity = "critical" | "high" | "medium" | "low";

/** Production progress for one product edition. */
export interface Edition {
  edition: string;
  required: number;
  packed: number;
  remaining: number;
  completion_pct: number;
  hours_needed?: number | null;
}

/** A human-reviewable issue found in source data. */
export interface Risk {
  severity: Severity;
  title: string;
  detail: string;
  evidence: string;
  action: string;
  owner?: string | null;
}

/** Status and plain-language result for one analysis agent. */
export interface Agent {
  name: string;
  status: string;
  result: string;
}

/** A file-level difference between imported data snapshots. */
export interface ChangeEvent {
  kind: string;
  severity?: Severity;
  path: string;
  summary: string;
  detected_at: string;
}

/** Complete dashboard response from the launch API. */
export interface LaunchBrief {
  customer: string;
  release: string;
  deadline: string;
  status: string;
  generated_at: string;
  summary: {
    required: number;
    packed: number;
    remaining: number;
    completion_pct: number;
  };
  editions: Edition[];
  risks: Risk[];
  agents: Agent[];
  sources: Array<{ name: string; facts: string[] }>;
  limitations: string[];
  data?: {
    imported: boolean;
    file_count: number;
    row_count: number;
    warning_count: number;
    imported_at: string | null;
    portal_sync_enabled: boolean;
  };
  events: ChangeEvent[];
  operating_priorities?: Array<{ title: string; detail: string; source: string }>;
}

/** Result returned after importing or syncing a portal snapshot. */
export interface ImportResult {
  file_count: number;
  changed_count: number;
}
