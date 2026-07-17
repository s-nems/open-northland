# Make the vacant-seat Idle/AI toggle drive a real auto-player

**Area:** sim + app · **Origin:** map player-roster work 2026-07-17 · **Priority:** P3
**Blocked by:** docs/tickets/sim/ai-player-scaffold.md

The map-select roster panel (menu) lets the person toggle every UNCLAIMED claimable slot between
"Idle" and "AI" (defaulting to the authored `playerdata` type), and only deviations from that
default ride the start URL as `?vacant=<slot>:<idle|ai>,…`
(`entries/menu/players.ts` `rosterStartParams`; parsed nowhere yet — documented as a
forward-looking control in `game/player-session.ts`). Both modes currently behave identically:
the seat's authored units stand around under settler micro-AI.

## Scope

1. When the strategic AI player exists (docs/tickets/sim/ai-player-scaffold.md), a
   slot resolving to `ai` (authored type, overridden by its `?vacant=` entry) gets an AI brain
   exactly like a map-authored `ai`-type slot; an `idle` slot gets none (today's behavior).
2. Parse `?vacant=` in the `?map=` entry next to `?player=`/`?colors=`
   (`game/player-session.ts`) and hand the slot list to the sim's AI seat wiring. Determinism:
   the flag reaches the sim as setup data/commands, never as app-side per-tick reads.
3. Menu already gates Start on a claimed seat; no menu work expected here.

Blocked by the AI-player scaffold producing an attachable AI player. Do not build the brain
here — this ticket is only the seat-level attach of an existing one.

## Verify

- Headless: a sim started with an ai-resolved slot issues AI commands for it; an idle slot issues none.
- `npm test`, `npm run check`, `npm run build`.

## Named scope gap

The original lobby's third seat state — Closed (`PLAYER_TYPE_NONE`, the slot removed from the
game) — has no roster-panel control; vacant seats are only Idle/AI. Closing a seat is a sim-setup
concern (don't spawn the slot's authored units) and belongs with this ticket's wiring.
