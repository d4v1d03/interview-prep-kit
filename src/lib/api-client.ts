/**
 * Browser-side fetch for our JSON API. Every server error arrives as
 * `{ error: { code, message, details } }`; this turns it into an ApiClientError
 * the UI can branch on, and sends an expired session back to the login page.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Field-level messages from a 400, keyed by field name. */
  get fieldErrors(): Record<string, string[] | undefined> {
    return ((this.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {}) as Record<
      string,
      string[] | undefined
    >;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiClientError(0, "NETWORK", "Can't reach the server. Check your connection.");
  }

  if (res.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    // A full page load on purpose: an expired session should drop all client state, not keep it around.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?reason=expired&next=${next}`);
    throw new ApiClientError(401, "UNAUTHENTICATED", "Your session has expired.");
  }
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(res.status, error?.code ?? "HTTP_ERROR", error?.message ?? `Request failed (${res.status}).`, error?.details);
  }
  return body as T;
}
