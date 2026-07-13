# Hunt the decoded assets for a real arrow/rock projectile sprite

**Area:** pipeline + render · **Origin:** combat plan reconciliation, 2026-07-12 (split from
combat-feedback-closeout, 2026-07-13) · **Priority:** P3

The in-flight projectile is a minimal oriented-arrow placeholder
(`packages/render/src/gpu/sprite-pool/placeholder.ts` — "no arrow bob in the extracted `[bobseq]`
lanes"). **Source basis:** munition types ARROW 1 / ROCK 2 (logicdefines), per-weapon
`munitiontype`+`speed` (weapons.ini).

## Scope

Investigate-first — the outcome may be "no asset exists":

- Do the one-time hunt of the decoded effects/temp bmds for a real arrow/rock frame.
- If found: extract it into the IR and bind DrawKind `projectile`.
- If nothing is found: document that at the placeholder site and keep the primitive — that
  documented negative result closes this ticket.

## Verify

- `npm test`; a real pipeline run against the owned game copy if extraction changed.
- `?scene=battle` — arrow visible in flight — **user's eyes** if the sprite changed.
