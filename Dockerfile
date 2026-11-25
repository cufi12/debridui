# DebridUI + VxParser isolated integration-test image.
FROM oven/bun:1 AS base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/vxparser-venv \
    && /opt/vxparser-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/vxparser-venv/bin/pip install --no-cache-dir vxparser==1.5.0 \
    && chmod -R a+rwX /opt/vxparser-venv/lib/python3.*/site-packages/vxparser

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --no-save

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_PUBLIC_TRAKT_CLIENT_ID="__NEXT_PUBLIC_TRAKT_CLIENT_ID__"
ENV NEXT_PUBLIC_CORS_PROXY_URL="__NEXT_PUBLIC_CORS_PROXY_URL__"
ENV NEXT_PUBLIC_DISCORD_URL="__NEXT_PUBLIC_DISCORD_URL__"
ENV NEXT_PUBLIC_ANALYTICS_SCRIPT="__NEXT_PUBLIC_ANALYTICS_SCRIPT__"
ENV NEXT_PUBLIC_APP_URL="__NEXT_PUBLIC_APP_URL__"
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID="__NEXT_PUBLIC_GOOGLE_CLIENT_ID__"
ENV NEXT_PUBLIC_DISABLE_EMAIL_SIGNUP="__NEXT_PUBLIC_DISABLE_EMAIL_SIGNUP__"
RUN bun run build

FROM base AS runner
WORKDIR /app
LABEL org.opencontainers.image.title="DebridUI + VxParser (test)" \
      org.opencontainers.image.description="DebridUI with a local VxParser FastAPI sidecar for integration testing." \
      org.opencontainers.image.source="https://github.com/cufi12/debridui"

ENV NODE_ENV=production PORT=3000 HOSTNAME="0.0.0.0" \
    VX_PARSER_ENABLED="true" VX_PARSER_PORT="8080"

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --no-log-init -g nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --chmod=755 .docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["python3", "scripts/run-services.py"]
