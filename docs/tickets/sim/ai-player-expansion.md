# Expand the AI player's territory when space or resources run short

**Area:** sim · **Origin:** enemy-AI design close-out 2026-07-17 · **Priority:** P2
**Blocked by:** docs/tickets/sim/ai-player-scaffold.md

The HomeExpansion module of the HAI-style AI player (pinned by the original's
`HAI_DisableHomeExpansion` toggle and the scripted layer's `AI_MainTask_BuildMilestone` verb —
expansion in Cultures is a first-class AI concern; internals a named genre-convention
approximation). Genre lesson (Petra's explicit design change from its predecessor): expansion
triggers on game-state conditions — no buildable space for the next planned building, a needed
deposit outside territory — not on timers.

## Scope

1. A module on the scaffold's seam that detects expansion pressure for the AI seat: build-order or
   workforce goals blocked by missing space/resources inside current territory.
2. Resolve it with the player's own tool: `placeSignpost` toward the blocked goal (nearest useful
   direction — deposit, open ground), reusing existing signpost placement validity checks.
3. Condition thresholds are named constants (or content data), no magic numbers; candidate search
   bounded around the territory border, not the whole map.

## Verify

- Headless scenario: an AI seat whose next build target has no in-territory space places a signpost
  and subsequently completes the build; same seed twice → identical hashes.
- `npm test`, `npm run check`, `npm run build`.
