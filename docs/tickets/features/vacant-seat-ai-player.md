# Make the roster seat mode three-state (Script/AI/Idle) and attach the AI player to any seat

**Area:** sim + app · **Origin:** map player-roster work 2026-07-17, reshaped by user direction
2026-07-17 · **Priority:** P2
**Blocked by:** docs/tickets/sim/ai-player-scaffold.md

The map-select roster panel currently gives every unclaimed claimable slot a two-state Idle/AI
toggle (`entries/menu/players/state.ts` `VacantMode`, `toggleVacantMode`), riding the start URL as
`?vacant=<slot>:<idle|ai>,…` with no consumer yet; both modes behave identically in game. The user
wants seats to be watchable test rigs: any seat — including the one a person would claim — can be
handed to the strategic AI player, and the toggle grows a third state for the map's authored
behavior.

Seat modes (menu labels: `Skrypt` / `AI` / `Bezczynny`):

- **Script** — the seat behaves as the map authored it. Today that means its authored units under
  settler micro-AI (static garrisons); when the scripted `[AIData]` `AI_MainTask_*` layer or the
  authored HAI toggles are implemented later, "script" is the mode that honors them. Default for
  authored `ai`-type slots.
- **AI** — the strategic AI player (docs/tickets/sim/ai-player-scaffold.md) plays the seat like a
  normal player, regardless of what the map authored.
- **Idle** — no brain at all; authored units stand under micro-AI only. Default for authored
  `human`-type slots left vacant.

## Scope

1. Extend `VacantMode` to `'script' | 'ai' | 'idle'` (cycle on click), defaulting from the
   authored `playerdata` type: `ai` slot → `script`, `human` slot → `idle`. Keep `aiAllowed`
   gating the `ai` option where the lobby table forbids it.
2. Offer the mode toggle on every non-hidden slot, not only unclaimed ones — a claimable seat set
   to `AI` is played by the AI system instead of a person. Start stays gated on a claimed seat
   only while some seat is claimable and none is claimed *or AI-assigned*; an all-AI roster starts
   as a watch-only game (the point: observing AI matches instead of hand-testing build orders).
3. Encode deviations in the start URL (`?vacant=<slot>:<script|ai|idle>,…`), parse them in the
   `?map=` entry next to `?player=`/`?colors=` (`game/player-session.ts`), and hand the resolved
   per-seat modes to the sim's AI seat wiring as setup data/commands — determinism: never app-side
   per-tick reads.
4. Localize the three labels in both catalogs (`pl-surfaces.ts` currently ships
   `vacantIdle: 'Bezczynny'` and an "AI not implemented" description — update both).

Do not build the brain here — this ticket is seat-level attach/UI only.

## Verify

- Headless: a sim started with an `ai` seat issues AI commands for it; `script` and `idle` seats
  issue none (until the scripted layer exists, they differ only in intent).
- Menu: toggle cycles three states with correct authored defaults; URL round-trips deviations;
  all-AI roster can start.
- `npm test`, `npm run check`, `npm run build`; browser pass over the menu + an AI-vs-AI map start.

## Named scope gap

The original lobby's third seat state — Closed (`PLAYER_TYPE_NONE`, the slot removed from the
game) — has no roster-panel control. Closing a seat is a sim-setup concern (don't spawn the slot's
authored units) and belongs with this ticket's wiring if it lands here, or a follow-up ticket.
