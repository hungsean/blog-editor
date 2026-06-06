# syntax=docker/dockerfile:1

# --- install production dependencies ---
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- runtime ---
FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache su-exec

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY index.ts ./
COPY src ./src
# drizzle/（版本化 migration）與 scripts/（baseline + migrate）是啟動時套 schema 所需。
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# data/ holds the SQLite DB, font cache and og-temp uploads — mounted as a volume.
# Created here so a fresh named volume inherits the directory + ownership.
RUN mkdir -p /app/data \
  && chown -R bun:bun /app \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
