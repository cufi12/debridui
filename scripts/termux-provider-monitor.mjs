#!/usr/bin/env node
/**
 * Termux provider repository monitor.
 * Checks repository manifests and enabled provider source files; it does not
 * execute third-party provider code or scrape stream links without a media query.
 */
import { readFile } from "node:fs/promises";

const CONFIG_PATH = process.env.PROVIDER_CONFIG || "termux-providers.json";
const INTERVAL_MS = Math.max(5, Number(process.env.PROVIDER_REFRESH_MINUTES || 30)) * 60_000;
const ALLOWED_HOSTS = ["raw.githubusercontent.com", "github.io", "gitlab.com", "gitlab.io", "codeberg.org", "git.invalidpanda.dev"];

function validateManifestUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith("." + host))) {
    throw new Error("Manifest URL must be HTTPS on a supported repository host.");
  }
  if (!url.pathname.toLowerCase().endsWith("manifest.json")) throw new Error("Manifest URL must end in manifest.json.");
  return url;
}

async function fetchText(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 1_000_000) throw new Error("Response exceeds 1 MB.");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function checkRepository(entry) {
  const manifestUrl = validateManifestUrl(entry.manifestUrl);
  const raw = JSON.parse(await fetchText(manifestUrl));
  const providers = raw.providers ?? raw.scrapers;
  if (!Array.isArray(providers)) throw new Error("Manifest has no providers/scrapers array.");
  const base = new URL(".", manifestUrl);
  const selected = providers.filter((provider) => provider && provider.enabled !== false);
  const results = await Promise.all(selected.map(async (provider) => {
    try {
      if (typeof provider.filename !== "string") throw new Error("Missing provider filename.");
      const file = new URL(provider.filename, base);
      if (file.protocol !== "https:" || file.origin !== base.origin || !file.pathname.startsWith(base.pathname.replace(/[^/]*$/, ""))) {
        throw new Error("Provider file URL is outside the manifest directory.");
      }
      const source = await fetchText(file);
      const normalized = source.trimStart().toLowerCase();
      if (!normalized || normalized.startsWith("<!doctype html") || normalized.startsWith("<html")) throw new Error("Empty file or HTML response.");
      return { id: provider.id ?? provider.filename, status: "ok", bytes: Buffer.byteLength(source, "utf8") };
    } catch (error) {
      return { id: provider.id ?? provider.filename ?? "unknown", status: "error", message: error.message };
    }
  }));
  const ok = results.filter((item) => item.status === "ok").length;
  console.log(new Date().toISOString(), entry.name ?? manifestUrl.hostname, "manifest OK;", ok + "/" + results.length, "provider files OK");
  for (const result of results) if (result.status !== "ok") console.warn("  Provider", result.id, result.message);
}

async function run() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (!Array.isArray(config.repositories) || config.repositories.length === 0) {
    throw new Error("Config must contain a non-empty repositories array.");
  }
  console.log("Provider monitor running; interval:", Math.round(INTERVAL_MS / 60_000), "minutes");
  const tick = async () => {
    for (const entry of config.repositories) {
      try { await checkRepository(entry); }
      catch (error) { console.error(new Date().toISOString(), entry.name ?? entry.manifestUrl, error.message); }
    }
  };
  await tick();
  setInterval(tick, INTERVAL_MS);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
