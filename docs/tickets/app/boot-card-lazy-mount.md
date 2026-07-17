# Don't mount or tax a boot that finishes fast

**Area:** app (view, entries) · **Origin:** review of feat/loading-screen, 2026-07-17 · **Priority:** P3

`view/boot-progress.ts` mounts its card unconditionally and every `begin()` awaits `nextPaint()` (a
double-rAF, capped at `PAINT_TIMEOUT_MS`). On a checkout without `content/` the whole boot is otherwise
sub-second, so the card appears, strobes its labels in a fraction of a second and vanishes — a flash
where there was none, and a boot measurably slower than before the card existed. `?map=` runs nine
`begin`s plus `finish`, so on a visible tab that is up to ~20 forced frames (~330 ms at 60 Hz).

The card is worth its cost on the real-content path it was built for (multi-second loads), and worthless
on a boot that beats the eye. It should decide which one it is instead of paying for both.

## Scope

- Arm a short timer (~200 ms) instead of mounting immediately; if boot reaches `finish()` first, never
  mount and never yield. Once mounted, `begin()` behaves as it does today.
- With no card up, `begin()` must record the current step and skip the yield — there is nothing to paint,
  which is the whole reason the yield exists.
- On mount, render the step that is already in flight, not the first one in the list.
- Keep `main.ts`'s `dismissBootProgress()` failure path correct for the never-mounted case (it is
  idempotent today).

## Verify

- `npm test` + `npm run check` + `npm run build`.
- `npm run dev` on a checkout **without** `content/` → `?map=` and `?scene=<id>`: no card, no flash, boot
  no slower than before.
- Same with `content/` present: the card still appears and steps as it does today. Human sign-off on the
  threshold — whether ~200 ms is the right line between "flash" and "reassurance" needs eyes.
