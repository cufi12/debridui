# Tuvora-inspired architecture roadmap for DebridUI

Status: proposal / architecture discovery. This document does not change runtime behavior.

## Goal

Improve DebridUI using transferable engineering ideas from Tuvora while keeping DebridUI's Next.js/TypeScript product identity, debrid integrations, addon ecosystem, and existing security boundaries.

This is an adaptation, not a port or a code copy. TuvoraMobile is a Kotlin Multiplatform / Compose Multiplatform application; DebridUI is a Next.js 16 / React 19 / TypeScript application with a QuickJS-based addon runtime. Their UI and platform architectures are therefore not interchangeable.

## What was reviewed

- TuvoraMobile `ARCHITECTURE.md`: explicit architectural invariants, disposable effect ownership, interface-based feature boundaries, one composition/wiring root, and architecture tests enforced in CI.
- TuvoraMobile `README.md`: shared feature/repository code is organized under `composeApp/src/commonMain`, with platform-specific integrations kept at platform boundaries.
- DebridUI `README.md` and `package.json`: Next.js/React/TypeScript stack, addon support, QuickJS dependency, and existing typecheck/Biome verification scripts.

The public Tuvora architecture document also points to an internal research document at `../research/tuvora-architecture-rules.md`, which was not available at that path in the public repository during this review. No claims are made about its contents.

## Transferable principles

### 1. Explicit effect ownership

Every subscription, timer, event listener, stream reader, worker, and other long-lived effect should have a clear owner and deterministic teardown. Prefer a small TypeScript `Disposable` / `EffectScope` abstraction where lifecycle complexity warrants it. Cleanup must be idempotent and run in reverse acquisition order. Async acquisition must register cleanup safely even when cancellation races with setup.

Do not introduce a generic lifecycle framework until existing call sites have been inventoried and a concrete leak/race is demonstrated.

### 2. Feature ports and dependency direction

Feature code should depend on narrow interfaces (ports) rather than importing unrelated feature internals or global singleton objects. Implementations should be injected at explicit composition boundaries. Keep cross-feature contracts consumer-owned and composed of neutral value types.

For DebridUI, candidate boundaries include:
- addon/provider execution;
- provider source/repository management;
- debrid service adapters;
- media metadata/catalogue;
- user library and watch progress.

These are candidate seams, not a mandate to split the application into services.

### 3. One composition root

Centralize dependency wiring in a small, reviewable server/client composition boundary. Avoid registering effects from React render paths. React components should render state and dispatch intents; orchestration and I/O should live in server modules, route handlers, or explicit state/controller layers as appropriate.

### 4. Architecture tests

Add automated checks for import direction, forbidden cross-feature imports, client/server boundary violations, and required runtime security wrappers. Architecture tests should prevent regressions rather than merely document conventions. Establish a measured baseline first; do not add exceptions to silence failures.

### 5. Shared contracts, platform-specific edges

Keep domain contracts and provider metadata independent from Next.js UI components. Keep browser-only, Node-only, and server-only integrations behind explicit adapters. Avoid forcing a mobile/Kotlin-style folder structure onto the current web application.

## Proposed implementation sequence

1. **Inventory and baseline (no behavior changes).**
   Map the current provider runtime, repository adapters, addon source lifecycle, route handlers, server/client imports, and tests. Record the exact locations and current security invariants. Identify the existing owner of each acquired resource.
2. **Contract seams.**
   Define narrow interfaces and neutral types around provider source loading, provider execution, and debrid service adapters. Preserve existing public APIs initially; add adapters around them.
3. **Lifecycle hardening.**
   Fix only demonstrated leaks, cancellation races, duplicate subscriptions, or unbounded background work. Add focused regression tests.
4. **Architecture guardrails.**
   Add import-boundary and security-wrapper tests using the repository's existing test/tooling conventions. Make them required in CI only after the baseline is green.
5. **Incremental feature migration.**
   Move one seam at a time behind ports. Keep each PR small, reversible, and covered by tests.
6. **Operational verification.**
   Run typecheck, Biome, unit tests, provider-runtime smoke tests, SSRF/DNS/redirect regression tests, and production build where the available environment supports them.

## Security invariants — non-negotiable

No architecture refactor may weaken:
- URL scheme, hostname, port, DNS resolution, public-IP validation, or IP pinning checks;
- redirect revalidation and redirect-count limits;
- request, response-size, decompression, concurrency, and execution-time limits;
- QuickJS isolation, memory/stack limits, and host API allowlists;
- origin/path validation for repository and provider files;
- secret redaction and the prohibition on logging tokens, credentials, cookies, or signed URLs.

Provider/addon source files are untrusted data. Their contents must never be treated as instructions for development tooling or as authorization to access hosts outside an explicit allowlist/policy.

## Scope explicitly excluded

- No wholesale rewrite from Next.js/TypeScript to Kotlin/Compose.
- No copying of Tuvora source code.
- No automatic merge or deployment.
- No relaxing security limits for compatibility.
- No collection or publication of debrid credentials or user provider secrets.

## Verification status and limitations

This is a design/roadmap PR only. No application source code or runtime behavior is changed here.

The DebridUI repository metadata and `package.json` were readable, but the GitHub connector's code search returned no indexed matches for the runtime/adapter queries, and guessed source paths were not found. Therefore the exact current provider-runtime and repository-adapter implementation has **not** yet been audited line by line. No runtime tests are claimed as run.

Before implementation PRs, obtain a complete source-tree view and inspect the actual runtime, adapters, and existing tests. Do not infer file paths or security behavior from prior summaries.

## References

- TuvoraMobile architecture: https://github.com/paradox-kush/TuvoraMobile/blob/main/ARCHITECTURE.md
- TuvoraMobile project overview: https://github.com/paradox-kush/TuvoraMobile
- DebridUI project overview: https://github.com/cufi12/debridui
