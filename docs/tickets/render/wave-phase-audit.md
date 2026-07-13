# Resolve the wave-phase code/doc contradiction against the corpus

**Area:** app content (render behavior) · **Origin:** map-visual-fidelity plan reconciliation,
2026-07-12 · **Priority:** P3

`packages/app/src/content/objects.ts` contradicts itself: the code sets `phase: hx + hy` (a
deliberate spatial gradient, from the "water repeated too many times" report) while the SAME
function's JSDoc claims "phase — 0 for every object … play IN UNISON". One of them is wrong about
the original.

## Scope

- Template-match wave frames over one corpus water patch (the kit lives in `docs/SOURCES.md`
  "Reference-screenshot corpus + template matching" — it serves several map-visual tickets, so it
  stays there) → decide unison vs gradient with evidence.
- Update the code AND the JSDoc to agree with the finding; name the source basis at the site.

## Verify

- Pure phase selection is unit-testable.
- River side-by-side (mosty-3/4 reference frames) — **user's eyes**.
