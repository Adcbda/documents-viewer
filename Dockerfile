# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM dependencies AS builder

ENV SKIP_LIBRARY_SYNC=1

WORKDIR /app
COPY web ./web

WORKDIR /app/web
RUN npm run build

FROM dependencies AS production-dependencies

RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/web/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/web/dist/standalone ./
COPY --chown=node:node docker/library-server.mjs ./library-server.mjs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "library-server.mjs"]
