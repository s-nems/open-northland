# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:22-alpine AS build

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @open-northland/api --include-workspace-root --no-audit --no-fund \
    && npx tsc --build packages/api \
    && mkdir -p /app/node_modules/@open-northland /app/node_modules/@noble /app/packages \
    && for dep in fflate node-unrar-js zod; do cp -R node_modules/$dep /app/node_modules/$dep; done \
    && cp -R node_modules/@noble/hashes /app/node_modules/@noble/hashes \
    && for pkg in api map-import formats data translations; do \
         mkdir -p /app/packages/$pkg \
         && cp packages/$pkg/package.json /app/packages/$pkg/ \
         && cp -R packages/$pkg/dist /app/packages/$pkg/dist \
         && ln -s ../../packages/$pkg /app/node_modules/@open-northland/$pkg; \
       done \
    && cp -R translations /app/translations

FROM node:22-alpine

ARG API_BUILD=
ARG API_GAME_VERSION=
ENV NODE_ENV=production \
    PORT=8790 \
    ON_API_DATA_DIR=/data \
    ON_API_REPORTS_DIR=/reports \
    API_BUILD=$API_BUILD \
    API_GAME_VERSION=$API_GAME_VERSION

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland API: the map catalogue, its converted maps and bug report intake" \
      org.opencontainers.image.licenses=AGPL-3.0-or-later

WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data /reports && chown node:node /data /reports
VOLUME /data /reports

USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "packages/api/dist/main.js"]
