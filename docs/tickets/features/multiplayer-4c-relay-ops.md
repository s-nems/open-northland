# Package and deploy the relay server

**Area:** web, desktop · **Focus:** packages/net-server, deploy/ · **Priority:** P2

The relay runs on the project owner's machine as a Docker image behind a TLS reverse proxy on a
subdomain of opennorthland.org, reached over `wss://`. The image must contain no decoded game data:
the server never loads content, so the boundary in `docs/LEGAL.md` holds by construction, and the
image can be shared.

## Scope

- A Docker image for `packages/net-server` built from the workspace without `content/`, configured by
  environment variables (port, public URL, room limits), with a health endpoint and structured logs.
- A deployment note under `deploy/` covering the reverse proxy with TLS, the `wss://` upgrade, and
  the health check; the existing nginx configuration in `packages/web` is the reference for the web
  side.
- Version reporting: the server announces its protocol version on connect so clients can refuse a
  mismatch in the lobby.
- Non-goals: no autoscaling, no accounts, no metrics stack.

## Verify

- The image builds on a checkout without `content/`, starts with only environment variables, and
  answers the health endpoint.
- A deployment on the subdomain answers a `wss://` handshake from the headless test client and plays
  a short two-client game through it.
- `npm run check`, `npm run build`, `npm test`, `npm run check:docs`.
