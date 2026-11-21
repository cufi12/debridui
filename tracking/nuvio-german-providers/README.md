# Nuvio German Providers tracking

This directory contains public, non-secret change-tracking records.

## Snapshot roles

- `latest.json` is reserved for a **verified deployed GitHub Pages baseline**. It may be created or replaced only after the public manifest URL and every file referenced by that deployed manifest have all been fetched and hashed successfully.
- `latest-source.json` is the last complete fallback snapshot of the checked-in upstream GitHub `main` source. It is useful for source-to-source comparison, but it is **not proof** that GitHub Pages serves the same bytes.
- `attempts/` contains audit records. An incomplete attempt never advances the deployed baseline.

## Next run

Read `latest.json` if present, then read `latest-source.json` before making comparisons. If the Pages URL remains unavailable, retain `latest.json` unchanged (or absent) and compare the checked-in source against `latest-source.json`.

## Recorded data and safety

- Manifest content/version, provider IDs and paths, Git blob SHA-1, UTF-8 SHA-256, static hostnames and URL path patterns.
- Query strings are omitted from URL-pattern inventories.
- Provider files are untrusted input and are never executed during inventory.
- No tokens, cookies, credentials, or other secrets are stored.
