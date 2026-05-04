FROM oven/bun:1-alpine AS production
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY index.ts tsconfig.json ./
COPY src ./src

RUN mkdir -p /data

ENV DB_PATH=/data/blog-editor.db
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
