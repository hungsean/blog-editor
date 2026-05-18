# syntax=docker/dockerfile:1

# --- build the Vite bundle ---
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# Empty VITE_API_URL -> the frontend calls a relative /api, which nginx proxies
# to the backend. Override this only when serving frontend and backend from
# different origins (then the backend must allow CORS).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

# --- serve static files + reverse proxy /api ---
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
