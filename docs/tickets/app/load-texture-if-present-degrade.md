# Make loadTextureIfPresent actually degrade instead of rejecting

**Area:** app (content/net.ts) · **Origin:** /refactor-cleanup on packages/app, 2026-07-17 ·
**Priority:** P3

`packages/app/src/content/net.ts` exists to keep "the degrade-gracefully policy in one place so it
can't drift per file" (its own module doc). Two of its three loaders honour that —
`fetchJsonOrNull` and `fetchImageData` both wrap their work in `try/catch` → `null`.
`loadTextureIfPresent` (~`:29`) does not:

```ts
export async function loadTextureIfPresent(url: string): Promise<TextureSource | undefined> {
  const res = await fetch(url, { method: 'HEAD' });   // rejects on a network/offline error
  if (!res.ok) return undefined;
  return loadAtlasSource(url);                        // rejects if the source fails to load
}
```

Neither the `fetch` rejection nor a `loadAtlasSource` throw is caught, so the returned promise rejects
where the callers' contract says it resolves to `undefined`. `content/ir.ts`'s `loadPlayerLut` (~`:284`)
documents exactly that contract: "Returns `undefined` when the pipeline hasn't produced it (a checkout
without `content/`), so a caller degrades to the baked-palette gallery instead of crashing." It is on
the main boot path via `content/sprite-sheet/human-sheet.ts` (~`:150`). Other consumers with the same
expectation: `content/gui-gfx.ts` (~`:85`, `:140`), `content/font-gfx.ts` (~`:104`),
`content/goods-gfx.ts` (~`:81`).

The HEAD probe only covers the "server answered 404" case; it does not cover a rejected fetch or an
unloadable PNG (a truncated/corrupt file the pipeline half-wrote).

**Source basis:** structural/contract, not a mechanic.

## Scope

Wrap the body in `try/catch` → `undefined`, matching its two siblings in the same file. Trim the module
doc's `loadTextureIfPresent` bullet so it describes the real policy (probe *and* error → `undefined`).

**Behavior change** (a rejection becomes a degrade) — arguably a bug fix; nothing in the repo depends
on it rejecting.

## Verify

`npm test`, `npm run check`, `npm run build`. Add a unit test in `packages/app/test/` driving the two
failure paths — but note `loadTextureIfPresent` takes no `fetchImpl` seam today (unlike
`fetchJsonOrNull`); adding one is in scope if it is what makes the test possible. Boot check: a
checkout without `content/` still reaches the flat/baked fallbacks.
