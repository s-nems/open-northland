# Close out combat feedback: real projectile sprite, miss/victim sounds, skeleton settle

**Area:** pipeline + render + audio · **Origin:** combat plan reconciliation, 2026-07-12

Three tracked gaps left over from the combat feedback step, small enough for one session:

1. **Real arrow/rock sprite.** The in-flight projectile is a minimal oriented-arrow placeholder
   (`packages/render/src/gpu/sprite-pool/placeholder.ts` — "no arrow bob in the extracted
   `[bobseq]` lanes"). Do the one-time hunt of the decoded effects/temp bmds for a real arrow/rock
   frame; if found, extract into the IR and bind DrawKind `projectile`; if not, keep the marker
   and record the gap. Source basis: munition types ARROW 1 / ROCK 2 (logicdefines), per-weapon
   `munitiontype`+`speed` (weapons.ini).
2. **Miss/victim sounds.** `soundtype_NoHit` miss swoosh (weapons.ini) and `Man/Woman Get Hit`
   victim grunts (logicdefines 97/98) are extracted but unwired — `packages/audio/src/data/
   bindings.ts` has no miss or `getHit` binding. Wire a miss event → NoHit swoosh and a
   victim-sex → GetHit grunt on `combatHit`/`projectileHit`.
3. **Skeleton settle animation.** The final bone pile now draws the REAL decoded `cadaver human
   bones` sprite (`packages/render/src/gpu/overlays/effects-layer.ts` `bones`), but the
   `skeleton_falling` settle (12 frames, cadaver chain `skeleton_falling 87 → cadaver_skeleton 81`)
   is still unplayed — bones appear instantly. Play the settle once before holding the bones frame.

## Verify

- `npm test`; `?scene=combat` (arrow visible and lands with a thunk; corpse falls).
- `?sounds` gallery by ear — **audio needs the user's sign-off**.
