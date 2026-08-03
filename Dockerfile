# syntax=docker/dockerfile:1

# ── Stage 1: build ──────────────────────────────────────────────────────────
# Prerender the SvelteKit site (adapter-static) into ./build.
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps against the lockfile first so this layer caches until deps change.
COPY package.json package-lock.json ./
RUN npm ci

# Build the static output.
COPY . .
RUN npm run build

# ── Stage 2: serve ──────────────────────────────────────────────────────────
# Serve the prerendered files over plain HTTP on :80. TLS and routing are
# handled upstream by Dokploy's Traefik reverse proxy.
FROM caddy:2-alpine AS runner

# Serving rules (pretty-URLs, 404 fallback, immutable asset caching, rss mime).
COPY Caddyfile.docker /etc/caddy/Caddyfile

# Only the built artefact ships in the final image — no Node, no node_modules.
COPY --from=builder /app/build /srv

EXPOSE 80

# Fail the container health check if Caddy stops answering on :80.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD wget -q --spider http://127.0.0.1:80/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
