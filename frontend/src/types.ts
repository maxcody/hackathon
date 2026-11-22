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
  rate_per_hour: number | null;
  hours_left: number | null;
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
  /** For received mail: Message-ID of the sent mail it answers. */
  in_reply_to?: string | null;
  /** Agent analysis of received mail. */
  analysis?: MailAnalysis | null;
}

/** Everything the inbox tab shows. */
export interface Mailbox {
  messages: MailMessage[];
  sender: string | null;
  status_source: string | null;
  incoming_configured: boolean;
  incoming_error?: string | null;
}

/** Something an email's sender commits to. */
export interface Commitment {
  what: string;
  quantity: string;
  date: string;
  price: string;
}

/** An agent's analysis of a received email. */
export interface MailAnalysis {
  message_id: string;
  status: "running" | "done" | "failed";
  updated_at: string;
  language: string;
  summary: string;
  translation: string;
  commitments: Commitment[];
  risks: string;
  next_step: string;
  notification_keys: string[];
  error: string | null;
}

/** A dataset in the Data tab's list (`/dataset`). */
export interface DatasetInfo {
  key: string;
  title: string;
  description: string;
}

/** How the Data tab shows one column; id kinds link to their own table. */
export interface DatasetColumn {
  key: string;
  label: string;
  kind: "text" | "qty" | "money" | "date" | "status" | "flag" | "balance" | "part" | "supplier" | "po" | "shipment" | "delivery_note" | "file";
  multi: boolean;
}

/** A link from each row to rows of another dataset with the same id. */
export interface RelatedLink {
  label: string;
  dataset: string;
  column: string;
  value_from: string;
}

/** One table of the Soony data set. */
export interface Dataset {
  key: string;
  title: string;
  source: string;
  columns: DatasetColumn[];
  related: RelatedLink[];
  rows: Array<Record<string, string | number | null>>;
}

/** Names and documents behind the ids in the Data tab. */
export interface Lookups {
  parts: Record<string, string>;
  suppliers: Record<string, string>;
  documents: Record<string, string[]>;
  open_orders: string[];
}

/** The latest run of an agent skill, e.g. the risk check (`/skills/{name}`). */
export interface SkillRun {
  skill: string;
  status: "never" | "running" | "done" | "failed";
  started_at: string | null;
  finished_at: string | null;
  summary: string;
  error: string | null;
}
