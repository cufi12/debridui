# Termux provider monitor

This optional Node.js worker periodically checks configured Nuvio-style provider repositories from Android/Termux. It validates each manifest and checks enabled provider source files. It does **not** execute provider JavaScript, fetch film/episode stream links without a search request, or modify DebridUI's database.

## Termux setup

Install Node.js 20+ and Git, clone DebridUI, then:

```sh
cp termux-providers.example.json termux-providers.json
nano termux-providers.json
```

Add each repository manifest URL that you want to monitor. Keep this local config private if repository URLs are private.

Run once in the foreground:

```sh
node scripts/termux-provider-monitor.mjs
```

Keep it running in a Termux session. For Android background operation, install Termux:Boot from the same source as Termux and configure a boot script only after verifying the foreground command works. Android battery optimization may still stop background processes; disable battery optimization for Termux if you want more reliable monitoring.

Override the interval (minimum 5 minutes):

```sh
PROVIDER_REFRESH_MINUTES=30 node scripts/termux-provider-monitor.mjs
```

The default is 30 minutes. The worker checks manifests and enabled provider files only. Actual stream discovery still happens when DebridUI searches for a specific movie or episode.
