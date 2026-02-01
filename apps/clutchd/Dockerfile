FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/clutchd/package.json ./apps/clutchd/
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.base.json ./
COPY apps/clutchd ./apps/clutchd
RUN pnpm --filter clutchd build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/clutchd/dist ./dist
COPY --from=builder /app/apps/clutchd/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/index.js"]
