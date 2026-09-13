# syntax=docker/dockerfile:1

# The site is the same bytes on every architecture, so it is built once on the builder's own
# platform and only the finished files enter the per-architecture runtime image. Nothing in that
# image runs a command, which is what keeps the arm64 build free of emulation.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build

# Assembling the site needs neither a browser nor an Electron binary, and those two downloads dwarf
# the rest of the install.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci && npm run web:site

FROM nginx:1.31-alpine

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland web shell: the browser installer and game host" \
      org.opencontainers.image.licenses=GPL-3.0-or-later

COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/packages/web/dist/site /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget --quiet --spider http://127.0.0.1/healthz || exit 1
