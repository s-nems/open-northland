# Give the AI player a minimal military module: defense stance + recruitment

**Area:** sim · **Origin:** enemy-AI design close-out 2026-07-17 · **Priority:** P3
**Blocked by:** docs/tickets/sim/ai-player-scaffold.md

The Military module of the HAI-style AI player (pinned by the original's `HAI_DisableMilitary`
toggle; internals a named genre-convention approximation). Deliberately last and minimal: the AI
player's primary purpose is watching economy games play themselves — build order and expansion
matter, micro does not. Scenario maps in the original mostly script attacks by hand
(`AI_MainTask_Attack` waves in `ai.inc`); an autonomous raid loop is optional polish.

## Scope

1. Maintain a small defensive force: recruit when the economy affords it (depends on the barracks
   pipeline — see docs/tickets/features/barracks-recruitment.md — until then, only manage soldiers
   the map spawns), keep them near home via `setStance`/`moveUnit`.
2. Optional, behind a module flag: periodic raid toward the nearest enemy once force exceeds a
   named threshold — condition-triggered, no timers-only escalation.
3. Reuse existing combat stances; no new combat mechanics here.

## Verify

- Headless scenario: an AI seat with soldiers keeps them positioned at home and (if raids enabled)
  launches one when the threshold condition holds; same seed twice → identical hashes.
- `npm test`, `npm run check`, `npm run build`.
