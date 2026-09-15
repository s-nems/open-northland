# syntax=docker/dockerfile:1

# The web demo: nginx serving the built app and the converted content from one document root. Both
# trees are built outside the image and arrive as named build contexts, so the root .dockerignore
# keeps excluding them from every other build:
#
#   docker buildx build --file deploy/web/Dockerfile \
#     --build-context app=packages/app/dist --build-context content=content deploy/web
#
# The content is decoded original game data; the image is for the private registry only.
FROM nginx:1.31-alpine

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland web demo: the game with its converted content" \
      org.opencontainers.image.licenses=AGPL-3.0-or-later

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=app / /srv/open-northland/
COPY --from=content / /srv/open-northland/

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget --quiet --spider http://127.0.0.1/healthz || exit 1
