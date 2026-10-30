# Se construye desde la raíz del repo (docker-compose.yml ya lo hace).
FROM node:22-slim AS web-build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

# Caddy sirve la web estática y pasa /api al backend
FROM caddy:2 AS web
COPY --from=web-build /web/dist /srv/web
COPY server/Caddyfile /etc/caddy/Caddyfile

# Backend comercial: aplica migraciones y arranca API + tareas
FROM node:22-slim AS app
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
USER node
CMD ["sh", "-c", "npx tsx src/cli/migrate.ts && npx tsx src/index.ts"]
