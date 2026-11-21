/** HTTP verbs currently exposed by the FastAPI routes. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** One actual request and response recorded by the API explorer. */
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
