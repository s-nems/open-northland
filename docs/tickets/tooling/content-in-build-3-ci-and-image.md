# Build the converted content in CI and ship it inside the installers and the web image

**Area:** tooling, pipeline, desktop · **Focus:** release · **Priority:** P2

After the two preceding tickets nothing but a developer's shell produces `content/`: the desktop
`extraResources` entry copies an empty tree on a CI runner, and there is no web image at all. A
release must build the content once from the archive at `https://game.opennorthland.org/cnmod.zip`
(594,572,420 bytes, SHA-256 `68537a89a972621f5dc400912e0c660bd875f649b693f3dad70d26f49465f043`) and
feed the same tree to every artifact. A full conversion takes about ten minutes on a developer
machine and runs once per manual release; it is not cached, because a cache key would have to track
every package the pipeline depends on (`data`, `render`, `vfs`) and a miss there ships stale content.

## Scope

- `scripts/build-content.mjs`, exposed as a root npm script: takes `--zip <file>` or downloads the
  archive, verifies the SHA-256 (the only place that constant lives), extracts to a temporary
  directory with the system `unzip`, runs the pipeline with `--mod-root` into a fresh `content/`
  (an existing tree is removed first), and fails loudly on a hash mismatch or a pipeline error. Linux
  and macOS only.
- `deploy/web/`: an nginx `Dockerfile` that copies the prebuilt `packages/app/dist` and `content/`
  into one document root (no `npm ci`, no build stage in the image), an `nginx.conf` with the app at
  `/`, `/assets/` immutable, everything else `no-cache`, `/healthz`, and a `smoke-image.mjs` that
  starts the image and checks `/`, `/ir.json`, `/maps-index.json`, one map sidecar, one bobs atlas
  manifest, `/healthz`, and that a missing content path is 404 rather than `index.html`. The root
  `.dockerignore` excludes `content` and `**/dist`; use named build contexts or a Dockerfile-scoped
  ignore file rather than weakening the root one.
- `.github/workflows/release.yml`: a `content` job on Ubuntu that runs the build script and uploads
  `content/` as a workflow artifact; `installers` and a new `image` job depend on it and download the
  artifact into `content/` before `npm run build`. The `image` job builds and pushes
  `ghcr.io/<repo>-web:sha-<short>`, pulls it back and runs the smoke check; `publish` retags `latest`
  for web and relay as before and its notes name both images. Keep all current installer targets.
  State in the notes that release assets and the GHCR package are private and need a login.
- `docs/DEVELOPMENT.md`: how to build content locally from the archive, how to build and smoke the
  image locally, and that both artifacts contain decoded original content and are never pushed to a
  public registry.
- Non-goals: moving the relay Dockerfile, the server's compose file, code signing, and the
  private-project rewrite of `LEGAL.md`/`README.md` (next ticket).

## Verify

`npm run check`, `npm run check:docs`, `npm run build`. The build script run with `--zip` on the
local archive yields a `content/` whose file list equals a direct `--mod-root` run (only the
manifest's `generatedFrom` and Ogg page serials may differ). `docker buildx build --load -f
deploy/web/Dockerfile` followed by the smoke script passes, and the game served from that container
lists maps, starts one, and keeps a save across a reload. `npm run desktop:dist` on macOS produces
an app that starts a map with no `content/` in the checkout. The workflow itself can only be proven
by a `workflow_dispatch` on the remote; name that as the remaining human step in the handoff.
