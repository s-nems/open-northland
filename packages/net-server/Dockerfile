# syntax=docker/dockerfile:1

# The relay is plain JavaScript, so it is compiled once on the builder's own platform; only the two
# compiled packages and their single runtime dependency enter the per-architecture image. It never
# holds the simulation or a content directory: the boundary in docs/LEGAL.md holds by construction.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /src
COPY . .
# The relay workspace with what its build needs (the root's tooling, and the packages its types come
# from); what runs is bounded by the runtime stage alone. The runtime layout is assembled here so that
# stage only copies it: a stage without a command of its own builds for another architecture without
# emulation.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @open-northland/net-server --include-workspace-root --no-audit --no-fund \
    && npx tsc --build packages/net-server \
    && mkdir -p /app/node_modules/@open-northland /app/packages/net-protocol /app/packages/net-server \
    && cp -R node_modules/ws /app/node_modules/ws \
    && cp packages/net-protocol/package.json /app/packages/net-protocol/ \
    && cp -R packages/net-protocol/dist /app/packages/net-protocol/dist \
    && cp packages/net-server/package.json /app/packages/net-server/ \
    && cp -R packages/net-server/dist /app/packages/net-server/dist \
    && ln -s ../../packages/net-protocol /app/node_modules/@open-northland/net-protocol

FROM node:22-alpine

ARG RELAY_BUILD=
ENV NODE_ENV=production \
    PORT=8765 \
    RELAY_BUILD=$RELAY_BUILD

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland relay: the lockstep server a networked game runs through" \
      org.opencontainers.image.licenses=GPL-3.0-or-later

WORKDIR /app
COPY --from=build /app /app

USER node
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "packages/net-server/dist/main.js"]
