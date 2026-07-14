# Verify the wave-phase spatial gradient against the corpus

**Area:** app content (render behavior) · **Origin:** map-visual-fidelity plan reconciliation,
2026-07-12 (rewritten 2026-07-14 — the code/JSDoc contradiction this ticket originally tracked is
gone; code and doc now both say gradient) · **Priority:** P3

`packages/app/src/content/objects.ts` animates looping map objects with a spatial phase gradient
(`phase: hx + hy`, ~line 233) so water doesn't pulse as one stamp. The map stores no per-object
phase (named at the site), but whether the ORIGINAL plays waves in unison or staggered has never
been checked against evidence — the gradient came from a "water repeated too many times" report,
not from observation.

## Scope

- Template-match wave frames over one corpus water patch (the kit lives in `docs/SOURCES.md`
  "Reference-screenshot corpus + template matching" — it serves several map-visual tickets, so it
  stays there) → decide unison vs gradient with evidence.
- Update the code and its comment to the finding; name the source basis at the site. Confirming
  the current gradient is a valid outcome — then only the source-basis note changes.

## Verify

- Pure phase selection is unit-testable.
- River side-by-side (mosty-3/4 reference frames) — **user's eyes**.
