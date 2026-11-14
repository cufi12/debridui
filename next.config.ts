import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    reactCompiler: true,
    // Keep QuickJS outside the Next.js server bundle. Its Emscripten runtime
    // resolves the WASM binary relative to the installed package at runtime;
    // bundling it as a Next static asset breaks that lookup on Render.
    serverExternalPackages: ["quickjs-emscripten"],
    env: {
        NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    },
    async redirects() {
        // Friendly aliases for the canonical /movies and /shows slug routes (307, temporary).
        return [
            { source: "/movie/:slug", destination: "/movies/:slug", permanent: false },
            { source: "/film/:slug", destination: "/movies/:slug", permanent: false },
            { source: "/show/:slug", destination: "/shows/:slug", permanent: false },
            { source: "/tv/:slug", destination: "/shows/:slug", permanent: false },
            { source: "/series/:slug", destination: "/shows/:slug", permanent: false },
        ];
    },
};

export default nextConfig;
