# Clash Master - Multi-stage Docker Build
FROM node:22-alpine AS base

# Use a China-friendly npm registry mirror (registry.npmjs.org is unreliable
# from CN networks); remove these lines if you build outside China.
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
    COREPACK_NPM_REGISTRY=https://registry.npmmirror.com

# Install pnpm and build tools for native modules
RUN apk add --no-cache python3 make g++ gcc && \
    npm install -g pnpm@9.15.9

# Set working directory
WORKDIR /app

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/collector/package.json ./apps/collector/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build shared package first
RUN pnpm --filter @neko-master/shared build

# Build collector
RUN pnpm --filter @neko-master/collector build

# Build web with production env for PWA
ENV NODE_ENV=production
RUN pnpm --filter @neko-master/web build

# Create a minimal, deployable bundle for collector (production deps only)
RUN pnpm --filter @neko-master/collector deploy --prod /app/apps/collector-deploy && \
    mkdir -p /app/apps/collector-deploy/dist && \
    cp -r /app/apps/collector/dist/* /app/apps/collector-deploy/dist/

# Production stage
FROM node:22-alpine AS production

# Install wget for health checks
RUN apk add --no-cache wget

WORKDIR /app

# Default environment variables
ENV NODE_ENV=production \
    WEB_PORT=3000 \
    API_PORT=3001 \
    COLLECTOR_WS_PORT=3002 \
    DB_PATH=/app/data/stats.db

# Ensure data directory exists
RUN mkdir -p /app/data

# Copy collector (deploy bundle with production deps)
COPY --from=base /app/apps/collector-deploy ./apps/collector

# Copy web (Next.js standalone output)
COPY --from=base /app/apps/web/.next/standalone ./apps/web/.next/standalone
COPY --from=base /app/apps/web/.next/static ./apps/web/.next/standalone/apps/web/.next/static
COPY --from=base /app/apps/web/public ./apps/web/.next/standalone/apps/web/public

# Copy root package.json (optional, for reference)
COPY --from=base /app/package.json ./

# Expose ports
EXPOSE 3000 3001 3002

# Data volume
VOLUME ["/app/data"]

# Health check - verify API is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["/bin/sh", "-c", "wget -q --spider http://127.0.0.1:${API_PORT}/health || exit 1"]

# Start script
COPY docker-start.sh ./
RUN chmod +x docker-start.sh

CMD ["./docker-start.sh"]
