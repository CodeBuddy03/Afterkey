# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001
# Local-storage driver writes here; keep it writable for the runtime user and
# mount a persistent volume at /app/var in single-host deployments.
RUN mkdir -p /app/var/storage && chown -R nextjs:nodejs /app/var
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

# Background job worker (check-in escalations, release execution, email
# delivery, cleanup). Same build tree, separate process/container:
#   docker build --target worker -t afterkey-worker .
FROM build AS worker
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001
USER nextjs
CMD ["npx", "tsx", "src/worker/run.ts"]

# One-off migration runner (never run migrations from the web process):
#   docker build --target migrate -t afterkey-migrate .
#   docker run --rm --env-file .env.production afterkey-migrate
FROM build AS migrate
WORKDIR /app
ENV NODE_ENV=production
CMD ["npx", "tsx", "scripts/migrate.ts"]
