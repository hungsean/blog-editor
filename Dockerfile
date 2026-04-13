FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Create data directory
RUN mkdir -p /data

ENV DB_PATH=/data/blog-editor.db
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
