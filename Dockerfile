FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN adduser -D -h /app bot && mkdir -p /data && chown bot:bot /data
COPY --from=build --chown=bot:bot /app/dist ./dist
COPY --from=build --chown=bot:bot /app/node_modules ./node_modules
COPY --from=build --chown=bot:bot /app/package.json .
COPY --from=build --chown=bot:bot /app/src/database/schema.sql ./src/database/schema.sql
COPY --chown=bot:bot entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER bot
ENTRYPOINT ["/entrypoint.sh"]
