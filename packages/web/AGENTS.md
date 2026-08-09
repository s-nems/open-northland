# Web package contract

`packages/web` hosts the game in a plain browser at `opennorthland.org/game`: the shared installer
as a page, the asset pipeline in a dedicated worker, converted content in the origin-private file
system, and a service worker serving the content routes. The root [`AGENTS.md`](../../AGENTS.md)
applies.

## Boundaries

- The web app stays shell-agnostic and never imports web-shell code. The service worker serves
  `packages/app`'s build and generated content through `@open-northland/content-resolver`, the same
  route table as Vite and the desktop protocol.
- The site ships no game content. Every visitor converts their own copy; picked or dropped game
  folders are read-only inputs and their bytes never leave the browser.
- Run the pipeline only in the worker, never on the page; the page owns UI, storage layout, and the
  `ShellApi` implementation.
- Everything the shell stores lives under the one OPFS directory in `src/opfs-layout.ts` plus the
  locale key in `localStorage`; the rest of the origin's storage is not this package's.
- The deployed layout is fixed: the site at `/game/`, the app under `/game/play/`, the mod archive
  at `/cnmod/cnmod.zip` on the same origin. `scripts/serve.mjs` mirrors it for local verification
  and never deploys.

## Verification

Unit-test pure logic without a browser. The installer flow, worker conversion, and service-worker
routes need a real browser against an owned game copy; final look and feel need human review.
