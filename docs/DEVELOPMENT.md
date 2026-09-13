# Development reference

This page collects commands and local-only tools. The design rules live in [`./AGENTS.md`](../AGENTS.md)
and the test strategy in [`TESTING.md`](TESTING.md).

## Common commands

```bash
npm ci                  # install the locked dependency set
npm run dev             # browser development server
npm run desktop         # Electron development build
npm run relay           # lockstep relay server on PORT (default 8765)
npm run build           # typecheck and build the browser app, then report per-mode JS size
npm test                # normal Vitest suite
npm test -- scenario    # tests matching a name
npm run test:watch      # watch mode
npm run check           # Biome formatting and lint checks
npm run check:fix       # apply safe formatting and lint fixes
npm run check:docs      # validate Markdown and ticket links/contracts
npm run tickets:list    # priority-sorted ticket view
```

Use `npm install` only when dependencies or the lockfile need to change.

`dev` and `shot` compile the workspace packages before starting Vite, which resolves every
`@open-northland/*` import to that package's `dist/`. A running server keeps serving the build it
started with: restart it after changing sim, render, data, or audio source.

## Local game content

Generate content from your own game installation:

```bash
npm run pipeline -- --game "../Cultures 8th Wonder" --out content
```

The pipeline detects `DataCnmd/` inside the game directory. Pass `--mod-root <dir>` when the
CulturesNation mod is unpacked elsewhere, and `--mod-version <label>` to stamp the manifest with the
mod release the lobby compares between players. CnMod 1.3.1 is the current verified input; treat a
newer release as unverified until the real pipeline and content gates pass. The generated `content/`
tree is ignored by Git.

The music stage renders the DirectMusic soundtrack (`DataX/DM2`) to one ogg track per segment
entirely in Node: segment interpretation, DLS synthesis, reverb, and ogg encoding all run from npm
dependencies, with no native toolchain. Without `DataX/DM2` the stage is skipped with a note and
the game simply has no music.

Local content gates:

```bash
npm run test:content
npm run test:pipeline
npm run test:engines
```

`test:content` checks consumers against an existing `content/` directory. `test:pipeline` performs a
fresh conversion into a temporary directory and validates the result. It uses
`CULTURES_GAME_DIR` and, when needed, `CULTURES_MOD_ROOT`. `test:engines` boots the app in Electron
and the Playwright browsers and compares their state hashes with Node (see `TESTING.md`).

## Browser entries

`npm run dev` opens the main menu. With `content/backdrops/` present (see `npm run menu-backdrops`
below) the menu rotates captured settlement stills behind the grade; without them the static brand
art stands in. Direct entries are useful during focused work:

| URL query | Purpose |
| --- | --- |
| `?scene=<id>` | registered deterministic acceptance scene |
| `?art=gallery` | own animations, buildings, terrain and tilesets; comparisons and links to known real maps ([workflow](art/PIPELINE.md)) |
| `?art` | own-art review using the production terrain layer; synthetic ground, current civilian, filtering and scale controls; `&artMap=tutorial_005` checks an owned-map meadow patch with own textures |
| `?map=<id>` | decoded map |
| `?relay=<ws url>&room=<id\|new>` | decoded map played through a relay server; see below |
| `?anim` | character animation gallery |
| `?icons` | decoded sprite-frame gallery |
| `?sounds` | sound-binding gallery |
| `?shot` | single-frame screenshot entry used by the harness |
| `?backdrop=<id>` | one ambient-settlement frame of a decoded map, used by the menu-backdrop harness |

Common modifiers include `lang=<pol|eng>`, `fog=<...>`, `player=<...>`, `ai=<...>`, `sound=off`,
`intro=off` (skip the mission sheet a fresh world opens on), and `fullscreen=off`. `seed=<n>` picks
the world seed a `?map=` session runs on, so two clients of one session start from the same world;
without it the map entry keeps its fixed default. Without `lang`
the language follows the browser, and English stands in for a
browser language with no shipped catalog. The graphics settings (render scale, frame-rate limit,
post-processing) live in the stored settings and never enter the URL; `postfx=<on|off>` overrides
the stored post-fx choice for that entry, so captures stay reproducible whatever the machine's
settings. The HUD scales from the canvas height sampled at game start (capped at 1.25x) times the
stored interface-scale setting; `uiscale=<n>` pins an absolute scale for reproducible diagnostics and is
not carried across menu/game switches. The menu's settings screen covers the player-facing options,
so direct query parameters are mainly for reproducible diagnostics.

Debug modes:

- `debug=diag` records replay and state-hash diagnostics;
- `debug=perf` adds browser performance marks;
- `debug=trace` records a trace that can be exported for offline profiling;
- `debug=profile` accumulates per-system sim cost for the whole session.

Flags combine: `?debug=profile,trace` runs both.

A running game exposes `window.__opennorthland`. Besides the live `sim`, `renderer`, `sheet` and
`cameraCtl`, it answers `perf()` with one JSON-serialisable performance report, so an automated probe
reads numbers instead of screenshotting the on-canvas readout. `resetPerf()` opens a fresh measurement
window, and `setSpeed()` / `setPaused()` put the session into a state worth measuring: `setSpeed(1)`
gives a baseline the per-frame step cap cannot distort, and pausing isolates the render half of a
frame. Read `sampling.hidden` before trusting any timing: a background tab throttles its frame loop
and every millisecond becomes fiction.

A stored fullscreen preference is taken back on the session's first gesture, so a probe that clicks
resizes the viewport mid-measurement and also records its own window mode. Add `&fullscreen=off` to a
scripted URL: the session keeps the window it was given, stores nothing, and the menu shows no
fullscreen prompt.

## Screenshots

Create a deterministic screenshot:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Useful options are `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.
Screenshots still need human review.

Regenerate the menu-backdrop stills (the curated framings live in
`packages/app/scripts/menu-backdrops.mjs`):

```bash
npm run menu-backdrops
```

It boots each curated map through `?backdrop=<id>` and writes JPEGs into `content/backdrops/`,
which the menu rotates through. The stills render decoded original art, so they are gitignored
content, never repository files; re-run the command after `npm run pipeline`.

## Measuring performance

| question | reach for |
| --- | --- |
| what does the sim spend a tick on, and does it grow as the settlement develops? | `npm run bench:map` |
| does one axis (settlers, fighters) drive a system's cost? | `npm run bench:sim` |
| did my change make it slower? | `npm run bench:compare` |
| what does a live session spend a frame on, sim or render? | `?debug=profile` and `window.__opennorthland.perf()` |
| how much JavaScript does a URL mode download and parse before it starts? | the table `npm run build` prints |

Every report judges the machine that produced it. Numbers under an untrustworthy banner are void
rather than weak: re-run on an idle box instead of reading them.

`bench:sim` and `bench:map` each rebuild the workspace from scratch before measuring, so a bare run
describes the working tree rather than whatever was last built.

Run the synthetic simulation benchmark with `npm run bench:sim`. Its main controls are
`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`,
and `ON_BENCH_JSON`.

Run the real-map benchmark with `npm run bench:map`. It needs generated content and its controls are
`ON_BENCH_MAP`, `ON_BENCH_SEATS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`,
`ON_BENCH_SYNC_DIGEST` (fold the per-tick sync digest, what a networked session pays), and
`ON_BENCH_JSON`. `ON_CONTENT_DIR` points it at a content directory outside the checkout. The default
run is 20k ticks; `ON_BENCH_TICKS=50000` covers a full AI build-out.

Every run keeps its report under `bench-out/` (untracked), so a baseline exists without having been
planned for. `npm run bench:compare` with no arguments compares the two most recent runs of the same
world; `npm run bench:compare -- before.json after.json` names two explicitly, and `ON_BENCH_JSON`
overrides where a run writes.

## Relay server

```bash
npm run relay
PORT=9000 npm run relay
```

Builds the workspace and serves the multiplayer relay over WebSockets on `PORT`, with its health
check at `/healthz` on the same port. It loads no content and runs no simulation; the protocol it
speaks is [`NETWORK.md`](NETWORK.md). `HOST` binds one address, `RELAY_MAX_ROOMS` and
`RELAY_MAX_CONNECTIONS` cap the rooms and the open sockets, and `RELAY_PUBLIC_URL` and `RELAY_BUILD`
are what the health check reports as the address and the build; the log is one JSON record per
line, a failed start included. Every message it handles is exercised by the tests under
`packages/net-server/test`, and the decoded-map run in `npm run test:content` plays real sessions
through it in memory. `ON_RELAY_URL=wss://…` points the socket test at a deployed relay instead:

```bash
ON_RELAY_URL=wss://relay.opennorthland.org npx vitest run --project core packages/net-server/test/ws-host.test.ts
```

The main menu's **Multiplayer** screen (`?menu=multiplayer` opens it directly) accepts an editable
relay address (default `wss://relay.opennorthland.org`) and nickname, lists rooms, and creates games
from installed maps or local saves. Players choose seats and readiness explicitly; the creator
controls teams and settings.
Use separate browser profiles/private windows for two independent players. The default endpoint is
not deployed by the repository. For a local relay, enter `ws://127.0.0.1:8765`.

To serve an isolated generated content tree with Vite, set `ON_CONTENT_DIR` to an absolute path or a
path relative to the checkout. This is the same override the content test runner accepts. Restart
Vite after multiplayer source changes so its client build identity includes them.

The developer entry remains available in two windows of one dev server. The first creates
the room and waits for `players` people; it rewrites its URL to the room's id, which the others
join with:

```text
?relay=ws://localhost:8765&room=new&map=magiczny_las&players=2&nick=Ania
?relay=ws://localhost:8765&room=<id from the first window>&nick=Bartek
```

Each window sits in the first open seat and reports ready on its own; the creator starts once
everyone is. The reconnect token is stored separately for each relay origin and path; the nickname is
shared in stored settings. A reload rejoins the same seat; two windows of one browser profile share
the identity for that relay, so give the second a private window
or another profile. Enter opens the chat line. The perf overlay's third line and `perf().net` carry
the round trip, the assigned input delay, the click-to-apply time and the jitter buffer's depth. A
forced divergence for a resync check is a console mutation of `__opennorthland.sim` in one window.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
```

The packaged app stores generated content in the user's application-data directory. It never writes
playable content into the repository or application bundle.

## Web site build

```bash
npm run web:site
npm run web:serve
```

`web:site` assembles the static deployment for `game.opennorthland.org` under
`packages/web/dist/site`: the installer page, the pipeline worker, the service worker, and the app
built for the `/play` base. `web:serve` serves that layout locally on port 8788 (`PORT` overrides);
set `OPEN_NORTHLAND_CNMOD_ZIP=<path>` to also serve a local mod archive at `/cnmod.zip`. Visitors
convert their own game copy in the browser; the site ships no game content and the converted data
stays in each browser's origin-private storage.

## Web image

The `Release` workflow builds that site into a container and publishes it to
`ghcr.io/s-nems/open-northland-web`, for `linux/amd64` and `linux/arm64`. One dispatch builds the
desktop installers and this image from the same resolved commit. Every build gets a `sha-<short>`
tag; `latest` moves only once both halves and the download page are published, and only for a
dispatch of the branch head, so rebuilding an older commit cannot roll a deployment backwards.
Deploying is manual:

```bash
docker run --detach --restart unless-stopped --publish 127.0.0.1:8080:80 \
  ghcr.io/s-nems/open-northland-web:latest
```

The first publish creates the package as private, so make it public once in the repository's package
settings if the deployment should pull it without a token.

The container is a plain HTTP static host, so the proxy in front of it owns three things: the TLS
certificate for the subdomain, the mod archive at `/cnmod.zip` (~600 MB, requested same-origin),
and forwarding everything else to the container unchanged. The origin belongs to the game alone -
`sw.js` is served from its root and its scope is the whole origin. `/healthz` answers `ok` for a
health check, and requesting `/cnmod.zip` from the container itself returns a 404 that says the
origin is misconfigured.

To build and check the same image locally:

```bash
npm run web:image
node packages/web/scripts/smoke-image.mjs open-northland-web
```

The smoke check runs the image and asserts what the deployment contract requires: hashed assets
under `/play/assets/` are immutable, every fixed name revalidates, and the content routes and the
mod archive are misses rather than static files.

## Own-art production

Own assets are the default. Choose Own or Original in Settings → Graphics; changes during a game
apply to the next game. `assets=own` / `assets=original` URL parameters override the stored choice.

Own environment development on a playable map: `?map=magiczny_las&assets=own&intro=off`.
See [own asset runtime](art/OWN-ASSET-RUNTIME.md) for exports, markers and current coverage.

Use `npm run art -- list` and follow [the art pipeline](art/PIPELINE.md) for candidate builds, review,
approval and publication. This workshop is independent of `npm run pipeline`, which decodes the owned game.

## Relay image

The same workflow publishes the relay as `ghcr.io/s-nems/open-northland-relay`, tagged and promoted
the same way. The image is built from `packages/net-server/Dockerfile`: the relay and protocol
packages compiled once, then only those two and `ws` in a Node image, so it carries neither the
simulation nor a content directory. It starts on environment variables alone:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | Listening port |
| `HOST` | every interface | Address to bind; the image's health check probes loopback, so leave it unset in a container |
| `RELAY_PUBLIC_URL` | unset | Public `ws://` or `wss://` address reported by `/healthz` |
| `RELAY_MAX_ROOMS` | `64` | Maximum rooms |
| `RELAY_MAX_CONNECTIONS` | `256` | Maximum open WebSocket connections |
| `RELAY_BUILD` | unset | Build identifier reported by `/healthz`; stamped by the release image build |

Rooms live in memory; restarting the process ends every match. The relay writes one JSON record
per log line. TLS termination and deployment configuration belong to the operator.

Size the machine from the limits, not the defaults: a room can retain about 22 MiB of base64
snapshot text plus 16 MiB of serialized replay history, and JavaScript objects, input parsing and
output queues add more, so 64 rooms can approach 2.4 GiB in retained payloads alone. Each of 256
sockets can additionally receive a maximum-size message and queue about 43 MiB of output. Choose
`RELAY_MAX_ROOMS` and `RELAY_MAX_CONNECTIONS` for the machine and measure its workload.

To build and check the same image locally:

```bash
npm run relay:image
node packages/net-server/scripts/smoke-image.mjs open-northland-relay
```

The smoke check runs the image with a public address and a room cap, reads them back from
`/healthz`, has the relay refuse another protocol version by name and welcome its own, and lists
the image's packages to prove the boundary.
