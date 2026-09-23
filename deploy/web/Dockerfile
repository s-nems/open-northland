# syntax=docker/dockerfile:1
# app and content are named build contexts: --build-context app=packages/app/dist --build-context content=content
FROM nginx:1.31-alpine

# The master runs without root; only runtime state belongs in the writable temporary directory.
RUN sed -i '/^user /d; s!^pid .*;!pid /tmp/nginx.pid;!' /etc/nginx/nginx.conf

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland web app: the game with its converted content" \
      org.opencontainers.image.licenses=AGPL-3.0-or-later

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=app / /srv/open-northland/
COPY --from=content / /srv/open-northland/

USER nginx

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget --quiet --spider http://127.0.0.1/healthz || exit 1
