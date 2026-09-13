# Deploying the relay

The relay runs as one container behind a TLS reverse proxy on a subdomain, reached over `wss://`.
It holds no game content and runs no simulation, so the image is shareable; what it does is in
[`docs/NETWORK.md`](../../docs/NETWORK.md), and how it is built in
[`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md#relay-image). The files here are the deployment:

- `compose.yml` runs the published image, bound to the host's loopback interface;
- `nginx.conf` is the proxy's server block for the subdomain.

Both name `relay.opennorthland.org`; replace it with the subdomain in use.

## Configuration

The container reads its settings from the environment and needs nothing else:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | The port the relay listens on inside the container |
| `HOST` | every interface | The address to bind; leave it unset in the container, whose health check arrives on loopback |
| `RELAY_PUBLIC_URL` | unset | The `wss://` address the proxy exposes; reported by the health check |
| `RELAY_MAX_ROOMS` | `64` | Rooms held at once; `createRoom` is refused past it |
| `RELAY_MAX_CONNECTIONS` | `256` | Open WebSocket connections; further upgrades receive HTTP 503 |
| `RELAY_BUILD` | unset | What the health check reports as the build; the `Release` workflow stamps the commit, a local `npm run relay:image` leaves it unset |

A connection that does not introduce itself within ten seconds is closed. Each connection has a
traffic budget of 256 messages and 1 MiB per second, with bursts of 512 messages and two maximum-size
blob messages. Exceeding either budget closes the connection. Outgoing queues are capped at two
maximum-size blob messages (about 43 MiB); a recipient that exceeds the cap is disconnected. These
are deployment limits in addition to the protocol's per-message and per-tick limits.

## First deployment

1. Point the subdomain's `A`/`AAAA` records at the host and obtain a certificate, for example
   `certbot certonly --nginx -d relay.opennorthland.org`.
2. Install `nginx.conf` as a site (`/etc/nginx/sites-available/relay`, linked into
   `sites-enabled`), check it with `nginx -t`, and reload nginx.
3. Copy `compose.yml` to the host, set `RELAY_PUBLIC_URL`, and start it:

   ```bash
   docker compose up --detach
   ```

   The image is published by the `Release` workflow to `ghcr.io/s-nems/open-northland-relay`; the
   first publish creates the package as private, so make it public once in the repository's package
   settings, or log the host in with a token that can read it.

4. Check the deployment from outside:

   ```bash
   curl https://relay.opennorthland.org/healthz
   ```

   The answer names the protocol version, the build, the configured address, and the current room
   and client counts. Then play a short two-client game through it from a checkout:

   ```bash
   ON_RELAY_URL=wss://relay.opennorthland.org npx vitest run --project core packages/net-server/test/ws-host.test.ts
   ```

The game reaches it through the `?relay=wss://relay.opennorthland.org&room=…` entry described in
`docs/DEVELOPMENT.md`; a `wss://` address is the only kind the packaged desktop app can open outside
`localhost`.

## Operating

- Update: `docker compose pull && docker compose up --detach`. A running game is one process;
  restarting the container ends every room, so do it when the health check shows `"rooms": 0`.
- Logs: `docker compose logs --follow relay`. One JSON record per line with `time`, `event`, and the
  event's fields; the `listening` record repeats the configuration at every start.
- A protocol change ships as a new image and a new client together: a client of another version is
  refused at `hello` with a message naming both versions.
