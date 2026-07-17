# Grow the roster seat mode to three states (Script/AI/Idle) and cover claimed/closed seats

**Area:** sim + app · **Origin:** map player-roster work 2026-07-17, reshaped by user direction
2026-07-17; narrowed 2026-07-17 after the two-state attach landed · **Priority:** P2

The two-state attach is DONE: the roster panel's Idle/AI toggle now feeds the strategic AI — the
menu emits the full effective seat list as `?ai=<slot>,…` (`aiSeats` in
`entries/menu/players/state.ts`; authored-`ai` claimable slots default onto the list), and the
`?map=` entry enqueues `setPlayerAi` per listed seat. An observer pseudo-seat exists, so an all-AI
watch game is startable (observer + every seat toggled to AI). What remains:

1. **Third state — Script.** Extend `VacantMode` to `'script' | 'ai' | 'idle'` (cycle on click),
   defaulting authored `ai` slots to `script`, not `ai`. Script means "as the map authored it":
   today static garrisons under settler micro-AI; when the scripted `[AIData]` `AI_MainTask_*`
   layer or authored HAI toggles are implemented, script is the mode that honors them. (Until that
   layer exists, script and idle differ only in intent.)
2. **Toggle on every non-hidden slot,** not only unclaimed claimable ones — a non-claimable
   script slot set to `AI` is played by the strategic AI. Start gating: some seat claimed or the
   observer taken (unchanged).
3. **Closed seats.** The original lobby's `PLAYER_TYPE_NONE` — the slot removed from the game
   (don't spawn its authored units). A sim-setup concern; needs its own toggle state or control.
4. Localize any new labels in both catalogs.

## Verify

- Menu: toggle cycles three states with correct authored defaults; URL round-trips; a script seat
  issues no strategic-AI commands, an AI one does (headless).
- `npm test`, `npm run check`, `npm run build`; browser pass over the menu + an AI-vs-AI start.
