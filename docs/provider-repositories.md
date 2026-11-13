# Provider repositories

DebridUI can load a Nuvio-style repository manifest and let each provider be enabled or disabled independently.

## Manifest format

The manifest URL must use HTTPS and be hosted on GitHub, GitLab, or Codeberg. The path must end in `manifest.json`.

```json
{
  "name": "Example repository",
  "version": "1.0.0",
  "description": "Example provider collection",
  "providers": [
    {
      "id": "example-movies",
      "name": "Example Movies",
      "description": "Example movie and series scraper",
      "version": "1.0.0",
      "filename": "providers/example.js",
      "supportedTypes": ["movie", "tv"]
    }
  ]
}
```

The legacy `scrapers` array is also accepted. Provider IDs must be unique within a repository. Provider files must remain on the same HTTPS origin and inside the manifest directory.

## Provider module format

Provider files use a single-file CommonJS export:

```js
module.exports = {
  async getStreams(tmdbId, mediaType, season, episode) {
    const response = await fetch("https://provider.example/search?id=" + tmdbId);
    const html = await response.text();

    // Parse the provider's response and return direct stream URLs.
    return [
      {
        name: "Example",
        title: "1080p WEB-DL",
        url: "https://cdn.example/video.mp4"
      }
    ];
  }
};
```

For movies, `mediaType` is `movie`. For series, it is `tv`, with `season` and `episode` supplied.

## Runtime and safety limits

- Provider JavaScript runs in QuickJS, not in the DebridUI application context.
- Provider code receives no Node.js APIs, filesystem access, process environment, or ambient user cookies.
- Outbound requests are limited to HTTP(S), public IPv4 destinations, and standard ports. Private/reserved network destinations are rejected and DNS results are pinned for each request.
- Up to eight enabled provider modules are executed per search, in batches of four. Each provider is limited to 12 requests, 1 MB per response, 3 MB total response data, 500 KB of source, 15 seconds of execution, 16 MB of VM memory, and a 512 KB stack.
- Redirects are revalidated and limited to three hops.
- The runtime supports the common single-file `module.exports.getStreams` shape, `fetch`, response `text()`/`json()`, basic `URL`/`URLSearchParams`, `atob`, `btoa`, and a no-op console. Providers that require Node modules, `require()`, third-party packages such as Cheerio, or other browser/native APIs may not work.
- Returned HTTP headers are retained on stream sources. Playback support for custom headers depends on the selected player; not every external player can apply them.

Providers are disabled by default when a repository is added. Enable only repositories and providers you trust.
