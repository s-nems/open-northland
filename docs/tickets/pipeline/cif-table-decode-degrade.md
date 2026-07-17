# Decide whether an undecodable `.cif` table should degrade or abort the run

**Area:** pipeline · **Origin:** data+pipeline refactor-cleanup pass, 2026-07-17 · **Priority:** P3
**Needs user:** degrade-vs-abort is a product call (a silently thinner IR vs a failed batch) — get the
owner's decision before executing.

`tools/asset-pipeline/src/stages/ir/cif-tables.ts` — `loadCifTable` documented a graceful-degradation
contract its code did not implement. `loadCifSections` returns `null` only when the file is **absent**;
a file that is present but **undecodable** throws out of `buildIr` → `writeIr` and aborts the whole
run. Every sibling stage (`gui`, `goods`, `bmd/bindings`, the map walk) warn-and-skips instead, so
this is the one place a corrupt optional source is fatal.

Five tables ride this path: `pattern.cif`, `trianglepatterntypes.cif`, `transitions.cif`,
`landscapes.cif`, `soundfx.cif`.

The refactor-cleanup pass corrected the **comment** to describe what the code actually does (the
behavior-preserving half) and deferred the code question here, because changing it is a real behavior
change: a corrupt `.cif` would stop aborting and start emitting an IR that is silently missing those
records — arguably worse than a loud failure, arguably better than no build at all.

## Scope

Pick one and implement it:

- **Degrade** (matches the sibling stages): wrap the decode in `loadCifSections`'s guard so an
  undecodable table returns `null` → `fallback`. Must warn loudly (`[pipeline] <file> undecodable,
  skipping`) so a thinned IR is never silent.
- **Abort** (keep today's behavior): leave the code and keep the corrected comment. Close this ticket
  and delete it, recording the decision in the commit.

If degrading, consider whether all five tables deserve the same treatment — `landscapes.cif` feeds map
object joins and `pattern.cif` feeds terrain rendering, so a partial one may be worse than none.

## Verify

- `npm test`, `npm run check`, `npm run build`.
- `npm run test:pipeline` — a fresh run against the owned copy must still produce the full IR.
- If degrading: add a synthetic case pinning that a corrupt `.cif` yields the fallback + a warning
  (the existing specs use synthetic bytes only — never real game data).

## Source basis

Internal robustness policy; no original-behavior claim. The `.cif` decode itself is pinned by
`test/cif.test.ts`'s round-trip fixtures.
