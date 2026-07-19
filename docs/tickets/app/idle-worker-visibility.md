# Surface stalled workers without clicking settlers one at a time

**Area:** app · **Origin:** gatherer idle-loop soak review, 2026-07-19 · **Priority:** P3

A worker that has stopped working is currently invisible unless the player happens to select that exact
settler: `packages/app/src/hud/details-panel/model/settler.ts` is the only place a settler's idleness is
surfaced, and only for the one settler shown.

That is an economic-readability gap, not a cosmetic one. The known remaining stall in
`docs/tickets/sim/dynamic-route-reachability.md` (a collector permanently unproductive from tick ~25k on
a dense iron field) reads to a player as "my iron income stopped" with no affordance for finding out
which settler, where, or why. RTS/economy-sim convention is to make this findable — a count, a jump-to
control, or a map ping.

The gatherer soak (`npm run soak:gatherers`) already computes exactly this classification headless
(`packages/app/soak/gatherer-stalls.ts`: unproductive span, `stranded` / `parkedAtFlag` / `noTarget`),
so the shape of the signal is settled; what is missing is a player-facing surface for it.

## Scope

- Decide the surface: a stalled-worker count in the stats window with a cycle-to-next control is the
  cheapest useful version; a minimap ping is the more faithful one. Pick one, do not build both.
- Derive the signal from live sim reads in the app layer — do not add a stall-tracking component to the
  sim for a HUD feature.
- Localize the strings (English only in this repo; the i18n agent owns Polish).

## Verify

- An acceptance scene under `packages/app/src/scenes/` with a headless assertion that a deliberately
  walled-off collector is reported, plus a human browser pass on the visual.
