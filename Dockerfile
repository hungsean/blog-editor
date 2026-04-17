FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build the editor bundle
RUN bun run build:editor

# Production stage
FROM oven/bun:1-alpine AS production
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=base /app/index.ts ./
COPY --from=base /app/tsconfig.json ./
COPY --from=base /app/public ./public
COPY --from=base /app/src ./src

# Create data directory
RUN mkdir -p /data

ENV DB_PATH=/data/blog-editor.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
