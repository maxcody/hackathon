/** Severity an agent assigns to a notification (free text in the backend). */
export type Severity = "critical" | "warning" | "info";

/** Fields the agents' notifications tool stores in a notification's `data`. */
export interface NotificationData {
  key?: string;
  title?: string;
  kind?: string;
  severity?: string;
  status?: string;
  status_note?: string;
  details?: string;
  refs?: string[];
  [field: string]: unknown;
}

/** One mismatch between the ERP and the customer side (`/notifications`). */
export interface Notification {
  id: number;
  attr: string;
  erp_val: string | null;
  customer_val: string | null;
  data: NotificationData;
  seen_at: string;
}

/** Result of `POST /import/sync`: portal files downloaded into the data folder. */
export interface SyncResult {
  added: string[];
  changed: string[];
  failed: string[];
  unchanged: number;
}

/** Result of `POST /import/master`. */
export interface MasterImportSummary {
  products: number;
  components: number;
  bom_lines: number;
  bom_changes: number;
  skipped_updates: string[];
}

/** Result of `POST /import/sheets`. */
export interface SheetImportSummary {
  rows: Record<string, number>;
  skipped_rows: string[];
  ignored_sheets: string[];
}

/** A user-created agent listed in the workspace. */
export interface AgentSummary {
  id: string;
  name: string;
}

/** An agent's independent chat and instructions. */
export interface WorkspaceAgent extends AgentSummary {
  instructions: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}
