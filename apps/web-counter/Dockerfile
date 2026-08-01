# Vite PWA → static, served by nginx. BUILD CONTEXT = REPO ROOT.
#   docker build -f apps/web-counter/Dockerfile -t rcm-counter .
FROM node:20.18.0-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json turbo.json ./
COPY apps/web-booking/package.json apps/web-booking/
COPY apps/web-admin/package.json   apps/web-admin/
COPY apps/web-counter/package.json apps/web-counter/
COPY packages/api-client/package.json   packages/api-client/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json           packages/ui/
RUN npm ci

COPY packages ./packages
COPY apps/web-counter ./apps/web-counter

ARG VITE_TENANT_ID
ENV VITE_TENANT_ID=$VITE_TENANT_ID
RUN npx turbo run build --filter=@rcm/web-counter

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-counter/dist /usr/share/nginx/html
EXPOSE 80
