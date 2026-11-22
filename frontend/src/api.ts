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

/** Send a solution's (possibly edited) email; returns the updated notification. */
export function sendSolutionEmail(
  notificationId: number,
  index: number,
  email: { to: string[]; cc: string[]; subject: string; body: string; approved_by?: string },
): Promise<Notification> {
  return request(`/notifications/${notificationId}/solutions/${index}/send`, json("POST", email));
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

/** Send a message and receive text as the selected agent generates it. */
export async function sendAgentMessage(
  id: string,
  message: string,
  onDelta: (text: string) => void,
): Promise<WorkspaceAgent> {
  const response = await fetch(`/api/agent-workspace/${encodeURIComponent(id)}/chat/stream`, json("POST", { message }));
  if (!response.ok || !response.body) throw new Error(`Chat request failed (${response.status}).`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The chat connection closed before the reply finished.");
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line) as
          | { type: "delta"; text: string }
          | { type: "done"; agent: WorkspaceAgent }
          | { type: "error"; detail: string };
        if (event.type === "delta") onDelta(event.text);
        if (event.type === "done") return event.agent;
        if (event.type === "error") throw new Error(event.detail);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
