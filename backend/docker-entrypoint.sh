#!/bin/sh
set -e

mkdir -p /app/data

if [ "$(id -u)" = "0" ]; then
  chown -R bun:bun /app/data
  # 降權到 bun 後再續跑本腳本（避免以 root 寫 DB / 跑 migration）。
  exec su-exec bun:bun "$0" "$@"
fi

# 以 bun 使用者執行 schema 套用（#02）：
# baseline 對既有資料庫標記初始 migration 已套用（空庫會自動略過），再跑增量 migrate。
bun run scripts/baseline.ts
bun run scripts/migrate.ts

exec "$@"
