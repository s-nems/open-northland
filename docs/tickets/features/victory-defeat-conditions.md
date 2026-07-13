# Add a sim win/lose seam with an end-of-game surface

**Area:** sim + app · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P1

There is no win/lose state or objective tracking anywhere: a grep for `victory|defeat|objective`
across `packages/sim/src` and `packages/app/src` (2026-07-13) hits only scene assertion labels
(`scenes/sandbox.ts`, `scenes/combat.ts`), an unrelated comment in `game/map-start.ts`, and a pun in
`hud/tool-panel/stats-window.ts` — zero gameplay logic. A battle can wipe out every settler and the
game just keeps ticking. Source basis: the minimal skirmish conditions below are a **named
approximation** (AGENTS.md rule 5 — the original has no automatic sim oracle); the original's
authored campaign goals live in `map.cif` `MissionData` and come later.

Two halves, only one blocked:

- **Hardcoded skirmish win/lose — executable now, this ticket.** E.g. a player is defeated when
  they have lost all settlers (or all settlers + all buildings — pick one and name the
  approximation); the last surviving player wins. Deterministic, evaluated in the sim.
- **Authored campaign goals** fed from decoded mission triggers.
  Blocked by: docs/tickets/pipeline/missiondata-extraction.md — do NOT build it here; leave a
  clearly named seam (an objectives evaluator the trigger interpreter can later feed) and file the
  follow-up ticket.

## Scope

1. A sim-side end-of-game system (`packages/sim/src/systems/`): per-tick (or cheap event-driven)
   defeat/victory evaluation over player-owned entities; result recorded in sim state and emitted as
   a `SimEvent`. Per-tick cost must scale with players/active work, not entities squared (rule 6) —
   prefer counting via existing stores/events over full-world scans.
2. Terminal-state semantics: decide and document what a finished game does — sim keeps ticking but
   rejects/ignores further gameplay commands, or halts; make it deterministic either way (the
   command log + golden discipline applies).
3. App-side: consume the event and show a simple end-of-game surface (a plain DOM overlay in the
   style of the existing HUD windows is enough — "Victory"/"Defeat" + return to menu or dismiss).
4. An acceptance scene under `packages/app/src/scenes/` where one side is wiped out and the
   end-of-game state triggers, with a headless assertion + browser checklist entry.

## Verify

- Unit test: defeat fires exactly when the last qualifying entity dies; no false positives at
  game start (player with zero entities on tick 0 on maps that spawn later — decide and test).
- Headless scenario: two-player fight to elimination emits victory/defeat events deterministically
  (same seed, same tick).
- Acceptance scene in the browser: end-of-game overlay appears — **user's eyes**.
- `npm test`, `npm run check`, `npm run build`; goldens move only if terminal-state semantics
  intentionally change tick behavior (name it in the commit).
