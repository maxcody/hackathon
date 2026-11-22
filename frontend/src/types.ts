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
  solutions?: Solution[];
  [field: string]: unknown;
}

/** An email an agent prepared as (part of) a solution. */
export interface SolutionEmail {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  translation?: string;
}

/** One proposed way to solve a notification's problem. */
export interface Solution {
  kind: "email" | "internal" | "decision" | "claim";
  title: string;
  description: string;
  owner?: string;
  deadline?: string;
  cost?: string;
  /** Who must approve before acting (PP-07); empty if nobody. */
  approval?: string;
  email?: SolutionEmail | null;
  status?: "proposed" | "sent";
  sent_at?: string;
  approved_by?: string | null;
  sent_email?: Omit<SolutionEmail, "translation">;
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

/** Day-one progress of one launch product (`/readiness`). */
export interface Edition {
  product_id: string;
  name: string;
  day_one: number;
  packed: number;
  remaining: number;
  last_packed: string | null;
}

/** A shipment due at the site before launch. */
export interface Inbound {
  shipment_id: string;
  mode: string;
  eta: string;
  status: string;
  supplier_id: string;
}

/** Whether the stock of one part covers what is still to pack, per the ERP. */
export interface PartCoverage {
  component_id: string;
  description: string;
  critical: boolean;
  used_in: string[];
  need: number;
  stock: number;
  received_since: number;
  available: number;
  balance: number;
  inbound: Inbound[];
  suppliers: string[];
  fitted_into: string | null;
}

/** Launch readiness computed from the ERP files. */
export interface Readiness {
  launch_date: string;
  snapshot_date: string | null;
  editions: Edition[];
  parts: PartCoverage[];
  sources: string[];
}

/** One email in the inbox tab (`/inbox`). */
export interface MailMessage {
  direction: "out" | "in";
  message_id: string;
  at: string;
  sender: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** Brevo delivery status of outgoing mail, e.g. "delivered". */
  status: string | null;
  status_at: string | null;
}

/** Everything the inbox tab shows. */
export interface Mailbox {
  messages: MailMessage[];
  sender: string | null;
  status_source: string | null;
  incoming_configured: boolean;
}
