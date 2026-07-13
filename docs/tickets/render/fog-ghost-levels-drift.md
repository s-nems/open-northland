# Fog ghost of a mined deposit loses its ladder denominator (`levels`)

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-12 · **Priority:** P3

A live resource draw item carries both `level` (current fill) AND `levels` (the
denominator), so the resolver can rescale the sim's ladder onto the bound record's
own authored state count (stone rocks carry 4 states, ore mines 5). A fog GHOST of
the same node carries `level` but NOT `levels`:

- `data/scene/snapshot-readers/static-readers.ts` `assignStaticFields` (the shared
  reader) deliberately omits `levels` — the live build adds it separately in
  `data/scene/sprite-scene.ts`, and `data/fog-ghosts.ts` `FogGhost` has no `levels`
  field at all.

So a ghosted, partly-mined deposit on explored ground can render at the wrong visual
level (the ladder rescale sees no denominator and uses the raw sim level against the
record's state count). The render cleanup pass centralized the shared reads via
`assignStaticFields` but preserved this gap as-is (fixing it is a behavior change,
out of a behavior-preserving pass) — hence this ticket.

Source basis: observed data-flow asymmetry between the live path and the ghost path;
confirm against a real mined deposit under fog before/after.

## Scope

Decide whether a ghost SHOULD carry `levels` (almost certainly yes — a ghost is the
last-seen state, and a mined deposit's last-seen level meant something out of a
denominator). If so: add `levels` to `FogGhost`, capture it in `assignStaticFields`
(or in the ghost capture alongside `level`), and consume it in the ghost
re-projection in `sprite-scene.ts`. Watch the allocation note on `assignStaticFields`
— it writes in place on the per-frame build path; keep that.

## Verify

`npm run build`, `npm test` (fog-ghosts + scene suites — add a ghost-of-mined-deposit
case asserting `levels` survives). Visual: `npm run shot` of a partly-mined deposit
that has fallen under explored fog, before/after; human sign-off on the ghost frame.
