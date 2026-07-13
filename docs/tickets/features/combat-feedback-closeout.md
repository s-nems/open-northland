# Close out combat feedback: miss/victim sounds, skeleton settle

**Area:** render + audio · **Origin:** combat plan reconciliation, 2026-07-12 · **Priority:** P3

Two tracked gaps left over from the combat feedback step, small enough for one session (the
projectile-sprite hunt was split out to `docs/tickets/features/projectile-sprite-hunt.md`):

## Scope

1. **Miss/victim sounds.** `soundtype_NoHit` miss swoosh (weapons.ini) and `Man/Woman Get Hit`
   victim grunts (logicdefines 97/98) are extracted but unwired — `packages/audio/src/data/
   bindings.ts` has no miss or `getHit` binding. Wire a miss event → NoHit swoosh and a
   victim-sex → GetHit grunt on `combatHit`/`projectileHit`.
2. **Skeleton settle animation.** The final bone pile now draws the REAL decoded `cadaver human
   bones` sprite (`packages/render/src/gpu/overlays/effects-layer.ts` `bones`), but the
   `skeleton_falling` settle (12 frames, cadaver chain `skeleton_falling 87 → cadaver_skeleton 81`)
   is still unplayed — bones appear instantly. Play the settle once before holding the bones frame.

## Verify

- `npm test`; `?scene=battle` (attack lands with a thunk; corpse falls).
- `?sounds` gallery by ear — **audio needs the user's sign-off**.
