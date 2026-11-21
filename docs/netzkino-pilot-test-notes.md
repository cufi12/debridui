# Netzkino pilot: isolated safety checks

This pilot is a **testable safety boundary**, not a production provider integration.

## What is covered

- Stream identifiers are constrained to a single safe path segment.
- Stream URLs are constructed against one fixed HTTPS Netzkino host.
- API requests are restricted to the fixed HTTPS Netzkino API origin.
- Requests receive a real `AbortController` timeout (25 seconds by default).
- Non-success HTTP responses fail closed.

## Run

```sh
node --test scripts/netzkino-pilot.test.mjs
```

## Not yet verified

The current DebridUI runtime/provider integration points were not available for a reliable source-level review in this pass. No provider has been registered, no playback flow changed, and no live Netzkino API or stream request was made. Integration should wait until the app's actual provider contract and test environment are confirmed.
