/**
 * fetchWithTimeout — every external fetch must go through this so a wedged
 * upstream (Stripe, Supabase, Discord, an email provider, a social API…)
 * can never hang a request pipeline indefinitely. Node's native fetch has
 * NO default timeout, which is exactly how the app used to wedge whenever
 * the VPS egress flickered: requests parked on unresolved sockets piled up
 * and the server stopped answering.
 *
 * Defaults to 15s — long enough for cold egress, short enough to fail fast
 * and let the caller fall back (cached prices, stored values, friendly
 * errors) instead of blocking.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const { signal, ...rest } = init;
  // Combine a caller-provided signal (e.g. per-request cancel) with the
  // hard timeout so whichever fires first wins.
  if (signal) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeoutSignal]);
    return fetch(url, { ...rest, signal: combined });
  }
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}
