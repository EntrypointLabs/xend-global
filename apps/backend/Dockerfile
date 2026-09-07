# Backend container. Build context is the repo root: the backend imports
# @xend/smart-account from the workspace, so the package is copied and built
# alongside it rather than resolved from a registry it is not published to.
#
# The mobile workspace is deliberately never installed here. `npm ci` against
# the root lockfile with only these two package manifests present gives the
# backend its own dependency tree without pulling Expo in.

FROM node:22-slim AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/smart-account/package.json ./packages/smart-account/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
RUN npm ci --workspace @xend/backend --workspace @xend/smart-account \
  --include-workspace-root --ignore-scripts --legacy-peer-deps

COPY packages/typescript-config ./packages/typescript-config
COPY packages/smart-account ./packages/smart-account
RUN npm run build --workspace @xend/smart-account

COPY apps/backend ./apps/backend
RUN npm run build --workspace @xend/backend

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Migrations ship with the image so a release can apply its own schema before
# the first request reaches it.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /repo/apps/backend/dist ./apps/backend/dist
COPY --from=builder /repo/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=builder /repo/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /repo/apps/backend/drizzle.config.ts ./apps/backend/drizzle.config.ts
COPY --from=builder /repo/packages/smart-account ./packages/smart-account
COPY --from=builder /repo/package.json ./package.json

WORKDIR /repo/apps/backend
USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
