# Make the vacant-seat Idle/AI toggle drive a real auto-player

**Area:** sim + app · **Origin:** map player-roster work 2026-07-17 · **Priority:** P3

The map-select roster panel (menu) lets the person toggle every UNCLAIMED Human slot between
"Idle" and "AI", and the choice already rides the start URL as `?vacantai=<slot>,…`
(`entries/menu/players.ts` `rosterStartParams`; parsed nowhere yet — documented as a
forward-looking control in `game/player-session.ts`). Both modes currently behave identically:
the seat's authored units stand around under settler micro-AI.

## Scope

1. When the strategic AI player exists (design: docs/tickets/features/enemy-ai-opponent.md), a
   `vacantai` slot gets an AI brain exactly like a map-authored `ai`-type slot; an idle slot gets
   none (today's behavior, and the default).
2. Parse `?vacantai=` in the `?map=` entry next to `?player=`/`?colors=`
   (`game/player-session.ts`) and hand the slot list to the sim's AI seat wiring. Determinism:
   the flag reaches the sim as setup data/commands, never as app-side per-tick reads.
3. Menu already gates Start on a claimed seat; no menu work expected here.

Blocked by the enemy-AI design ticket producing an attachable AI player. Do not build the brain
here — this ticket is only the seat-level attach of an existing one.

## Verify

- Headless: a sim started with a vacantai slot issues AI commands for it; an idle slot issues none.
- `npm test`, `npm run check`, `npm run build`.
