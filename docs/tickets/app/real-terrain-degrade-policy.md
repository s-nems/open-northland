# Own the real-terrain degrade policy in loadRealTerrain so `?scene=` boots a bare checkout

**Area:** app (content/terrain.ts + entries) · **Origin:** /refactor-cleanup on packages/app,
2026-07-17 · **Priority:** P2

`packages/app/AGENTS.md` requires that a checkout without the gitignored `content/` still boots.
`?scene=<id>` does not: `src/entries/scene.ts` (~`:79`) calls `const terrain = await loadRealTerrain();`
unguarded. `src/content/terrain.ts`'s `loadRealTerrain(ir?)` falls back to `loadIr()` and **throws**
("content/ir.json not found. Run `npm run pipeline`…") when it returns `null` — and `loadIr()` returns
`null` rather than throwing precisely so callers can degrade. `entries/main.ts` does
`return renderSceneMode(...)` under `void main()`, so the rejection is unhandled: crash banner, no
scene. `entries/scene.ts`'s own doc claims hand-authored fallbacks for a bare checkout; it doesn't
deliver them.

Root cause: `loadRealTerrain`'s throw contract is read three different ways by its three callers.
`entries/map.ts` (~`:82-90`) treats it as recoverable (`if (ir !== null) { try { … } catch { diag.warn('content', 'real terrain unavailable, flat tint fallback') } }`);
`entries/scene.ts` lets it escape; `entries/shot.ts` (~`:79`) gates it behind an opt-in `?terrain` so it
can only throw when explicitly requested. A `Promise<TerrainTextureSet>` that throws on the *normal*
degraded path pushes the policy onto every caller, and one forgot. `content/net.ts` already states the
intended shape: the degrade-gracefully policy lives "in one place so it can't drift per file".

**Source basis:** structural/contract, not a mechanic — no original-game behavior involved.

## Scope

- Make the degrade policy `loadRealTerrain`'s own: return `TerrainTextureSet | undefined` (matching
  `content/net.ts`'s `loadTextureIfPresent`), `undefined` when the IR or its textures are absent.
- Keep a throwing path only for `entries/shot.ts`'s explicit `?terrain` opt-in (a separate
  assert-y wrapper, or shot.ts throws itself on `undefined` — the deterministic PNG must not silently
  change basis).
- Simplify `entries/map.ts`'s `if (ir !== null) { try/catch }` to the plain `undefined` check, keeping
  the `diag.warn('content', …)` on the degraded path.
- `entries/scene.ts` passes the `undefined` straight through to the renderer's flat-tint fallback.

**Behavior change, bare checkouts only:** `?scene=` goes from crash → degraded flat-tint render. A
checkout with real `content/` is unaffected.

## Verify

- `npm test`, `npm run check`, `npm run build`.
- The seam: with `content/` absent (e.g. `git stash`-style move it aside, or a fresh clone),
  `npm run dev` → `?scene=sandbox` must boot and render flat-tint terrain with a `diag.warn`, not a
  crash banner. Pin it headlessly if the loader can be driven with an injected fetch
  (`fetchJsonOrNull` already takes `fetchImpl`).
- With `content/` present, `?scene=`, `?map=` and the `?shot` PNG are unchanged (the shot PNG must stay
  byte-identical).
