# ─────────────────────────────────────────────────────────
# Stage 1: Dependencies
# ─────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --include=dev

# ─────────────────────────────────────────────────────────
# Stage 2: Build
# ─────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/

RUN npm run build

# ─────────────────────────────────────────────────────────
# Stage 3: Runtime
# ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

RUN adduser -D -h /app bot && \
    mkdir -p /data && \
    chown bot:bot /data

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
COPY src/database/schema.sql ./dist/schema.sql

COPY --chown=bot:bot entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER bot

HEALTHCHECK NONE

ENTRYPOINT ["/entrypoint.sh"]
