# Web package contract

`packages/web` hosts the game in a plain browser at `game.opennorthland.org`: the shared installer
as a page, the asset pipeline in a dedicated worker, converted content in the origin-private file
system, and a service worker serving the content routes. The root [`AGENTS.md`](../../AGENTS.md)
applies.

## Boundaries

- The web app stays shell-agnostic and never imports web-shell code. The service worker answers the
  generated-content routes through `@open-northland/content-resolver`, the same route table as Vite
  and the desktop protocol; everything else, `packages/app`'s own build included, is the host's.
- The site ships no game content. Every visitor converts the mod archive in their own browser, and
  its bytes never leave the browser. `scripts/bundle.mjs` fails the build if the assembled site
  carries a single original-game file extension.
- Run the pipeline only in the worker, never on the page; the page owns UI, storage layout, and the
  `ShellApi` implementation. Import shell constants from a package's leaf subpath, never from a
  barrel that also exports the conversion: the installer page is the first thing a visitor
  downloads.
- Everything the shell stores lives under the one OPFS directory in `src/opfs-layout.ts`, plus the
  locale key in `localStorage` and the boot's reload guard in `sessionStorage`; the rest of the
  origin's storage is not this package's.
- The page addresses its own files relatively, and the service worker derives the app prefix from
  where `sw.js` was served, so the site works under any mount point. Only the app's build base is
  absolute. Keep it that way: an absolute URL added here pins the deployment to one path.
- Every path out of the boot must end in something the visitor can read. A missing service worker,
  absent origin storage, a full quota, or a second converting tab are conditions to report, never to
  fall through.

## Deployment contract

The host serves a static directory over HTTPS and nothing else. Plain HTTP runs neither service
workers nor OPFS, and these facts are not negotiable:

- the origin belongs to the game alone. `sw.js` is served from the site root, so its scope is the
  whole origin, and anything else hosted there would be routed through the game's service worker;
- the layout is fixed - the site at `/`, the app under `/play/`, the mod archive at `/cnmod.zip` on
  the same origin (`scripts/serve.mjs` mirrors it locally and never deploys);
- a conversion belongs to the origin, not to the path. Moving the site within one origin keeps every
  visitor's content; moving it to another origin makes all of them convert again and strands the old
  copy in their browser;
- only `play/assets/*` carries content hashes. Everything else ships under a fixed name and must not
  be long-cached, `sw.js` least of all: a stale service worker keeps serving old logic until the
  visitor clears their storage;
- the content-route prefixes under `/play/` belong to the resolver, so the app must not ship a
  static file at one of them - the service worker answers those from OPFS, while `npm run dev`
  would serve the file and hide the clash.

`Dockerfile` and `nginx.conf` here are that host, published as a container image beside the desktop
installers of the same commit. The image carries the site and nothing else: the certificate and the
mod archive belong to the proxy in front of it. `scripts/smoke-image.mjs` holds the rules above to
the built image.

## Verification

Unit-test pure logic without a browser. The installer flow, worker conversion, and service-worker
routes need a real browser against the mod archive; final look and feel need human review.
