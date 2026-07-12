# Relayer container. Build context is the repo root (see docker-compose.yml),
# but only apps/relayer files are copied: the relayer is built as a
# standalone package inside the image rather than through the npm workspace,
# so the heavy mobile workspace is never installed here. This is a
# deliberate pilot simplification; the relayer's own package.json pins the
# kit versions exactly.

FROM node:22-slim AS builder
WORKDIR /app
COPY apps/relayer/package.json ./package.json
# --legacy-peer-deps: @nestjs/schedule@4's peer metadata predates Nest 11,
# but the pairing runs fine (apps/backend ships the same combination). This
# matches how the workspace-root install tolerates it.
RUN npm install --legacy-peer-deps
COPY apps/relayer/tsconfig.json apps/relayer/tsconfig.build.json apps/relayer/nest-cli.json ./
COPY apps/relayer/src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY apps/relayer/package.json ./package.json
EXPOSE 8787
CMD ["node", "dist/main"]
