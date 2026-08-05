# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

ARG OPEN_NORTHLAND_BASE_PATH=/game

WORKDIR /workspace
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci
RUN OPEN_NORTHLAND_BASE_PATH="$OPEN_NORTHLAND_BASE_PATH" npm run build \
    && npm run bundle --workspace @open-northland/web-host

FROM node:22-bookworm-slim AS runtime

ARG OPEN_NORTHLAND_BASE_PATH=/game
ENV NODE_ENV=production \
    OPEN_NORTHLAND_BASE_PATH="$OPEN_NORTHLAND_BASE_PATH"

WORKDIR /app
COPY --from=on_content --chown=node:node / ./public
COPY --from=build --chown=node:node /workspace/packages/app/dist ./public
COPY --from=build --chown=node:node /workspace/packages/web-host/build/server.mjs ./server.mjs

USER node
EXPOSE 5173
CMD ["node", "server.mjs"]
