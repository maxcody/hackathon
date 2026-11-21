import type {
  AgentSummary,
  MasterImportSummary,
  Notification,
  NotificationData,
  SheetImportSummary,
  SyncResult,
  WorkspaceAgent,
} from "./types";

/** Make a typed request to the backend API. */
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

/** Construct a JSON request with the given method. */
function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** List the notifications the agents have posted. */
export function listNotifications(): Promise<Notification[]> {
  return request("/notifications");
}

/** Replace a notification's `data`, e.g. to change its status. */
export function updateNotificationData(id: number, data: NotificationData): Promise<Notification> {
  return request(`/notifications/${id}`, json("PATCH", { data }));
}

/** Download new or changed portal files into the backend's data folder. */
export function syncPortal(): Promise<SyncResult> {
  return request("/import/sync", { method: "POST" });
}

/** Reload products, components and BOM from the master CSVs. */
export function importMaster(): Promise<MasterImportSummary> {
  return request("/import/master", { method: "POST" });
}

/** Reload the sheet rows from every xlsx in the data folder. */
export function importSheets(): Promise<SheetImportSummary> {
  return request("/import/sheets", { method: "POST" });
}

/** List user-created agents. */
export function listWorkspaceAgents(): Promise<AgentSummary[]> {
  return request("/api/agent-workspace");
}

/** Create an agent with optional instructions. */
export function createWorkspaceAgent(name: string, instructions: string): Promise<WorkspaceAgent> {
  return request("/api/agent-workspace", json("POST", { name, instructions }));
}

/** Load a specific agent and conversation. */
export function getWorkspaceAgent(id: string): Promise<WorkspaceAgent> {
  return request(`/api/agent-workspace/${encodeURIComponent(id)}`);
}

/** Send a message to the selected agent. */
export function sendAgentMessage(id: string, message: string): Promise<WorkspaceAgent> {
  return request(`/api/agent-workspace/${encodeURIComponent(id)}/chat`, json("POST", { message }));
}
