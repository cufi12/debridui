# VxParser integration test

This branch is an isolated integration experiment. It does not change the production
branch or the currently deployed Render service.

## What this test does

- Installs the published `vxparser==1.5.0` Python package in the image.
- Starts its FastAPI API on `127.0.0.1:8080`.
- Starts DebridUI in the same container on Render's public `PORT`.
- Keeps the VxParser API private to the container; it is not exposed directly to
  the public internet.
- Disables VxParser's automatic scraper/background jobs initially.
- Clears the upstream package's example serienstream username/password defaults.

## Important limitations

1. This is a co-hosted two-process setup, not a rewrite of VxParser into Next.js.
2. The DebridUI UI/API has not yet been wired to call VxParser. This first stage
   only checks whether both applications can start together.
3. VxParser stores SQLite databases and generated files under its installed package
   directory. Render's free filesystem is ephemeral, so data may be lost on restart.
   A persistent disk would be needed for durable VxParser data.
4. Render's free web service can sleep when idle. Co-hosting does not remove that
   Render limitation.
5. The VxParser project is independently maintained. Review its license and source
   before using it in a public deployment.

## Test

Deploy this branch as a separate Render service (do not change the existing
`debridui` service). Check the logs for both VxParser and DebridUI startup.
The actual DebridUI UI integration should follow only after this backend test passes.
