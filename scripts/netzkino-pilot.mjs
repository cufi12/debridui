/**
 * Isolated Netzkino pilot safety helpers.
 *
 * This module is deliberately not wired into the DebridUI runtime yet. It
 * provides a small, testable boundary for the first provider integration.
 */

export const NETZKINO_API_ORIGIN = "https://api.netzkino.de.simplecache.net";
export const NETZKINO_STREAM_ORIGIN = "https://pmd.netzkino-seite.netzkino.de";
export const DEFAULT_TIMEOUT_MS = 25_000;

export function buildNetzkinoStreamUrl(slug) {
  if (typeof slug !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(slug)) {
    throw new TypeError("Invalid Netzkino stream identifier");
  }

  const url = new URL(`${slug}.mp4`, NETZKINO_STREAM_ORIGIN);
  if (url.protocol !== "https:" || url.hostname !== "pmd.netzkino-seite.netzkino.de") {
    throw new TypeError("Unexpected Netzkino stream destination");
  }
  return url.toString();
}

/**
 * Fetch only the fixed Netzkino API origin and enforce a real abort timeout.
 * The caller may inject fetchImpl for deterministic tests.
 */
export async function fetchNetzkinoApi(input, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch) {
  const url = new URL(input, NETZKINO_API_ORIGIN);
  if (url.protocol !== "https:" || url.origin !== NETZKINO_API_ORIGIN) {
    throw new TypeError("Netzkino API request must use the trusted HTTPS origin");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Netzkino request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Netzkino API returned HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Netzkino request timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
