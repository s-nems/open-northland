# Builds and packaging

## Build version

```bash
ON_VERSION=1.2.3 npm run build
```

Without `ON_VERSION`, the menu shows `dev`. The build writes `version.json` beside `index.html`:

| Field | Meaning |
| --- | --- |
| `version` | Release version |
| `build` | Entry script name; changes on rebuild |
| `restore` | Hash of client sources and `content/ir.json`; null without content |
| `content` | Hash of every file in the content tree; null without content |

Released web tabs poll this file. A new build reloads from the menu; a local game can reload and
resume when `restore` matches. Relay close code `CLOSE_SERVICE_RESTART` returns to the menu.
To test updates, serve a build, open it, then rebuild into the same `dist/` with another version.

A build fetches content under `/c/<content>/`, so a release with other content bytes uses other
URLs. The hash is the sha256 of the tree's `sha256sum` manifest
(`find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`); a symlink in the
tree fails the build. Hashing the 1.4 GB, 3835-file tree adds 1 to 7 s to `vite build`, depending on
the disk cache. The dev server hashes nothing and serves bare paths. It and
`vite preview` also answer `/c/<any hash>/`, as do the desktop shell and `test:boot`.

## Source maps

A production build writes `hidden` source maps: the shipped JavaScript carries no `sourceMappingURL`
comment, and the build moves every `.map` out of `packages/app/dist/` into the ignored
`packages/app/dist-sourcemaps/`, so neither the web image nor an installer contains one. The maps
chain through the packages' `tsc` maps to the TypeScript sources and hold positions only, no source
text: read the positions at the build's commit. `build.json` beside them names the build as a bug
report does (`version`, `client`, `content`). A release keeps its maps privately.

To read a bug report's stacks:

```bash
node scripts/report/symbolicate.mjs <report dir or report.json> packages/app/dist-sourcemaps
node scripts/report/symbolicate.mjs report.json <maps dir> --json   # the whole report, rewritten
```

It rewrites every frame location a map covers, in the error's stack and source and in the log
entries, to a repository position such as `packages/sim/src/ecs/world.ts:335:23`, and warns when
the report's `build.version` or `build.client` differs from `build.json`. Chunk names carry their
content hash, so a chunk the two builds share still maps and any other frame stays as sent.

## Release checks

Run on the release commit before tagging. See [TESTING.md](TESTING.md) for prerequisites.

1. `npm test`, including the shader cost budget.
2. Windows shader compilation: `npm run test:shaders` on Windows, or dispatch CI with `shaders` enabled.
3. With local content: `npm run test:boot` and `npm run test:boot -- --docker`.
4. Boot on a Windows PC. Use the packaged desktop app or the primary checkout's LAN server:

   ```bash
   npm run dev -- --port 5173 --host 0.0.0.0
   ```

   Open `http://<host-ip>:5173/?map=magiczny_las`. The world should appear within seconds.

Linux/macOS tests do not prove compatibility with Windows GPU drivers.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
npm run test:desktop
```

| Command | Result |
| --- | --- |
| `desktop` | Opens `packages/app/dist` and `content/` in Electron; supports `ON_CONTENT_DIR` |
| `desktop:dist` | Packages the app and checkout's `content/` into `packages/desktop/release/`; ignores `ON_CONTENT_DIR` |
| `test:desktop` | Tests `app://` boot, imports and persistence across relaunch; needs local content |

Development starts in a normal window, preserving saved bounds.
`ON_DESKTOP_RESTORE_WINDOW=1 npm run desktop` restores the saved window mode, including fullscreen.
Packaged builds restore that mode by default and start fullscreen on a fresh profile.

A packaged build on Windows or macOS keeps the cursor inside the game window as the "Keep the cursor
in the game window" setting says. Development leaves the cursor free;
`ON_DESKTOP_CURSOR_CONFINE=1 npm run desktop` turns the hold on, and `=0` turns it off in a packaged build.

Installers include the content needed to play. The shell requests the discrete GPU and logs a `GPU:`
line. The FPS breakdown and `perf().gpu.adapter` show the adapter actually used by WebGL. If Windows
still chooses the integrated GPU, set the app to **High performance** in Settings > System > Display > Graphics.

## Brand assets

```bash
npm run brand
```

Edit masters in `tools/brand/source/`, regenerate, and commit masters and outputs together.
The command builds web icons, social images, desktop icons, the README logo and menu lockup.

- `emblem-small.svg`: icons up to 32 px; `emblem-16.svg`: 16 px icons.
- `emblem-mono.svg`: single-color badges and print.
- macOS gets a rounded-square icon; Windows/Linux get the bare shield.
- The Windows setup, uninstaller and portable exe and the mounted dmg add a corner badge:
  `badge-<variant>.png`, or `badge-<variant>-small.svg` up to 32 px.
- The horizontal lockup and wordmark are for web/press use.
- A master touching its canvas edge fails validation because it may be cropped.

## Web image

Build the app first, with `content/` present:

```bash
npm run build
npm run web:image
node deploy/web/smoke-image.mjs open-northland-web
docker run --rm --publish 8080:80 open-northland-web
```

`deploy/web/Dockerfile` copies the prebuilt app and content. It rehashes the content it ships and
refuses an app built against another tree, so build both from the same `content/`. It also writes a
`.gz` beside every js, css and json file for `gzip_static`.

| Path | Served | `Cache-Control` |
| --- | --- | --- |
| `/c/<content>/...` | the content tree only | `immutable` for 200, 206 and 304; `no-cache` otherwise |
| `/c/<other hash>/...` | 302 to the bare path | `no-store` |
| `/assets/...` | hashed app files | `immutable` for 200, 206 and 304 |
| other paths | the app, else the content tree | `no-cache` |

Missing paths return 404 and `/healthz` is the health endpoint. A CDN in front may cache everything
under `/c/` by these headers (for Cloudflare, a cache rule on URI path starting with `/c/` that
respects origin headers); the bare paths must stay uncached. On a read-only root the smoke check
proves every row: 200, 206 and 304 under both prefixes, misses under `/c/<content>/` and `/assets/`,
the redirect with its percent-encoding kept and the bare file it lands on, and the FLAC media type.

The hash covers content bytes only, not how they are served. A release that changes the headers,
media types or encoding of unchanged content under `/c/` needs a Cloudflare purge of `/c/*`;
browsers keep their copies until they evict them.

nginx runs unprivileged. The image supports a read-only root with writable `/tmp`.
Internal port 80 requires permission to bind low ports; restricted runtimes can set
`net.ipv4.ip_unprivileged_port_start=0` in the container network namespace.

## Relay image

```bash
npm run relay:image
node packages/net-server/scripts/smoke-image.mjs open-northland-relay
```

`packages/net-server/Dockerfile` supports `linux/amd64` and `linux/arm64`. It includes only the
compiled relay, protocol and `ws`, with no simulation or game content.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8765` | Listening port |
| `HOST` | all interfaces | Leave unset in containers so the loopback health check works |
| `RELAY_PUBLIC_URL` | unset | Public `ws://` or `wss://` URL in `/healthz` |
| `RELAY_MAX_ROOMS` | `64` | Room limit |
| `RELAY_MAX_CONNECTIONS` | `256` | WebSocket limit |
| `RELAY_BUILD` | unset | Printable build name, at most 128 characters; also a Docker build argument |
| `RELAY_HALL_FILE` | unset | JSON file keeping the server chat and recently seen players across restarts, such as `/var/lib/open-northland-relay/hall.json` on a volume mounted there |

Rooms exist only in memory: restarting ends all matches. Without `RELAY_HALL_FILE` the server chat and
the recently seen list start empty after each restart too; with it, the relay writes the file at most
every ten seconds after a change and once more on a clean stop, and moves a file it cannot read aside
to `<file>.rejected`. `docker logs -f <container>` shows JSON
room events, disconnects, desyncs and durations. While clients are connected, a status line reports
counts every five minutes. The operator supplies TLS and deployment configuration.

Set limits for the machine, not just the defaults. Each room can retain about 22 MiB of snapshot
text plus 16 MiB of replay history: about 2.4 GiB for 64 rooms, before other overhead. Each socket
can also receive a maximum-size message and queue about 43 MiB of output. Measure the real workload.

The smoke check verifies health settings, protocol rejection/acceptance and the image's package list.
For the map service, see [API image](API.md#api-image).
