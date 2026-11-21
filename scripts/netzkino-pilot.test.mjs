import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNetzkinoStreamUrl,
  fetchNetzkinoApi,
  NETZKINO_API_ORIGIN,
} from "./netzkino-pilot.mjs";

test("builds a fixed HTTPS MP4 URL for a valid provider slug", () => {
  assert.equal(
    buildNetzkinoStreamUrl("film_123-abc"),
    "https://pmd.netzkino-seite.netzkino.de/film_123-abc.mp4",
  );
});

test("rejects path traversal, URL injection, and non-string stream identifiers", () => {
  for (const slug of ["../evil", "https://evil.example/x", "a/b", "a?x=1", "", null, 42]) {
    assert.throws(() => buildNetzkinoStreamUrl(slug), TypeError);
  }
});

test("allows only the fixed HTTPS Netzkino API origin", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200 });
  await fetchNetzkinoApi("/capi-2.0a/search?q=test", {}, 100, fakeFetch);
  await assert.rejects(
    fetchNetzkinoApi("https://evil.example/steal", {}, 100, fakeFetch),
    /trusted HTTPS origin/,
  );
  await assert.rejects(
    fetchNetzkinoApi("http://api.netzkino.de.simplecache.net/path", {}, 100, fakeFetch),
    /trusted HTTPS origin/,
  );
});

test("aborts a stalled request at the configured timeout", async () => {
  const stalledFetch = (_url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });

  await assert.rejects(
    fetchNetzkinoApi("/capi-2.0a/search?q=test", {}, 15, stalledFetch),
    /timed out after 15ms/,
  );
});

test("surfaces non-2xx API responses as failures", async () => {
  const failingFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    fetchNetzkinoApi("/capi-2.0a/search?q=test", {}, 100, failingFetch),
    /HTTP 503/,
  );
});
