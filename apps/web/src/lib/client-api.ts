/** Browser-side JSON POST helper that surfaces the server's error message. */
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method: "POST" | "DELETE" = "POST",
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Map WebAuthn browser errors to something a person can act on. */
export function passkeyErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "The passkey prompt was cancelled or timed out.";
  if (name === "InvalidStateError") return "This passkey is already registered.";
  if (name === "SecurityError") return "Passkeys need HTTPS (or localhost). Check APP_URL.";
  return (e as Error)?.message ?? "Something went wrong.";
}
