# Share the content-index payload types instead of re-declaring them in the app

**Area:** app / content-routes · **Origin:** content-routes + desktop cleanup, 2026-07-17 · **Priority:** P3

`packages/content-routes` owns both the `/maps-index` + `/bobs-index` payload builders and their
entry types (`MapsIndexEntry`, `BobsIndexEntry`), and exports the types from its barrel. The app
cannot import them: the package is node-only (`src/routes.ts` and both builders import `node:fs`,
its tsconfig sets `types: ["node"]`, and `package.json` exports only `.` → the node `dist/index.js`).
So the browser side re-declares the same shapes by hand:

- `packages/app/src/entries/menu.ts` — `MapIndexEntry` (`id`, `name?`, `description?`, `minimap`),
  structurally identical to content-routes' `MapsIndexEntry`.
- `packages/app/src/entries/icons.ts` — a local `BobsIndexEntry` (`stem`, `base`, `variant`),
  identical to content-routes' export of the same name.

The two sides agree today (checked 2026-07-17); nothing enforces it. Renaming or adding a field in a
builder typechecks clean on both sides, and the app reads `undefined` at runtime instead of failing
the build. The blast radius differs per consumer: `menu.ts` validates the payload defensively
(`parseMapsIndex` field-checks every entry and skips bad ones), so a drift degrades the map list;
`icons.ts` casts straight to `BobsIndexEntry[]` via `fetchJsonOrNull<BobsIndexEntry[]>('/bobs-index')`
with no validation, so a drift silently yields entries whose fields are `undefined`.

## Scope

- Give `content-routes` a browser-safe types-only entry point (e.g. a `./types` subpath export
  pointing at a module with no `node:` imports), holding `MapsIndexEntry` + `BobsIndexEntry`.
- Re-export those types from the existing barrel so the node-side consumers (the Vite middleware,
  the desktop protocol handler) are untouched.
- Import them in `menu.ts` and `icons.ts` in place of the hand-written interfaces.
- Keep `parseMapsIndex`'s runtime validation — a shared type is a compile-time link, not a promise
  about what a host actually served; consider giving `/bobs-index` the same treatment in `icons.ts`.

## Verify

- `npm run check` + `npm run build` pass, and the app bundle still pulls no `node:` builtin (the
  types subpath must be type-only — a stray value import would break the browser build).
- Deliberately renaming a field on `MapsIndexEntry` now fails `packages/app`'s typecheck.
