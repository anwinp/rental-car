# Next.js (SSR) — BUILD CONTEXT MUST BE THE REPO ROOT:
#   docker build -f apps/web-booking/Dockerfile -t rcm-booking .
# (the prod compose already sets context: ..)
FROM node:20.18.0-bookworm-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

# 1) Workspace manifests first → cached npm layer
COPY package.json package-lock.json turbo.json ./
COPY apps/web-booking/package.json apps/web-booking/
COPY apps/web-admin/package.json   apps/web-admin/
COPY apps/web-counter/package.json apps/web-counter/
COPY packages/api-client/package.json   packages/api-client/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json           packages/ui/
RUN npm ci

# 2) Source for this app + the workspace packages it depends on
COPY packages ./packages
COPY apps/web-booking ./apps/web-booking

# 3) Build-time public env (inlined into the client bundle by Next)
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_TENANT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_TENANT_ID=$NEXT_PUBLIC_TENANT_ID

# turbo builds @rcm/web-booking and its workspace deps (^build) first
RUN npx turbo run build --filter=@rcm/web-booking

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20.18.0-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Bring the whole built monorepo (hoisted node_modules + .next) over
COPY --from=build /repo ./
WORKDIR /repo/apps/web-booking
EXPOSE 3000
# NEXT_PUBLIC_API_BASE_URL is re-read at server start for next.config rewrites()
CMD ["node", "../../node_modules/.bin/next", "start", "-p", "3000"]
