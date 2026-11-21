import type { ApiCallResult, HttpMethod } from "./types";

/** Call a backend endpoint and preserve its actual response for the UI.
 * @param path - Backend route and query string.
 * @param method - HTTP method for the request.
 * @param body - Optional JSON or browser request body.
 * @returns The response status, timing, and parsed body, including network errors.
 */
export async function callApi(
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
): Promise<ApiCallResult> {
  const started = performance.now();
  const id = crypto.randomUUID();
  const headers = new Headers();
  let requestBody: BodyInit | undefined;
  if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
    requestBody = body;
  } else if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  try {
    const response = await fetch(path, { method, headers, body: requestBody });
    const raw = response.status === 204 ? null : await response.text();
    let parsed: unknown = raw;
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = raw;
      }
    }
    return {
      id,
      method,
      path,
      status: response.status,
      statusText: response.statusText,
      durationMs: Math.round(performance.now() - started),
      ok: response.ok,
      body: parsed,
      at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      method,
      path,
      status: 0,
      statusText: "Network error",
      durationMs: Math.round(performance.now() - started),
      ok: false,
      body: { error: error instanceof Error ? error.message : "Could not reach the API." },
      at: new Date().toISOString(),
    };
  }
}

/** Render a response as readable JSON, including non-JSON response bodies.
 * @param body - Response body returned by the backend.
 * @returns A readable string for the response viewer.
 */
export function formatResponse(body: unknown): string {
  if (body === undefined) return "";
  if (typeof body === "string") return body;
  return JSON.stringify(body, null, 2) ?? "null";
}
