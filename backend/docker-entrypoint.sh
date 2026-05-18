#!/bin/sh
set -e

mkdir -p /app/data

if [ "$(id -u)" = "0" ]; then
  chown -R bun:bun /app/data
  exec su-exec bun:bun "$@"
fi

exec "$@"
