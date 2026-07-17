# Design an enemy AI opponent: smallest strategic loop + follow-up tickets

**Area:** sim (design-first) · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P2

No opponent brain exists. `packages/sim/src/systems/agents/ai.ts` is the settler micro-planner
(per-settler job/flee/rest decisions), not a strategic player. `packages/app/src/game/rules.ts`
hardcodes `HUMAN_PLAYER = 0` / `ENEMY_PLAYER = 1`, and enemy units only fight via combat stances
when engaged — nothing on the enemy side builds, gathers, recruits, or attacks on its own
initiative. A skirmish against player 1 is a fight against a static garrison.

This is a **design-first ticket**: deliverable is a decision document (can live in the follow-up
tickets' context sections — do not create a new ledger) plus filed implementation tickets, NOT the
whole subsystem. Source basis: the original has no automatic sim oracle (AGENTS.md) — a **named
approximation** is expected. What can pin the design:

- Observed original behavior: play/observe an original skirmish or campaign map and note what the
  enemy observably does (does it expand? rebuild? raid on a timer? escalate?). If no observation
  session is feasible, say so and design from genre convention, named as such.
- Decoded map data: the `playerdata` roster/diplomacy and `MissionData` triggers are now decoded
  per map into `content/maps/<id>.script.json` (`MapScript` schema; `?vacant=` from the menu's
  roster panel already names which free Human seats should auto-play — see
  docs/tickets/features/vacant-seat-ai-player.md). The `[aidata]` sections (the `AI_MainTask_*` /
  `AI_SetCondition_*` program — 102 maps carry `AI_Disable`, 809 `AI_MainTask_Defend` lines) are
  still unextracted and strongly suggest campaign "AI" is authored task programs — check whether
  the original even has an autonomous economic AI before designing one. This is the key
  investigate-first question.

## Scope

1. Survey (timeboxed): what the original's enemy observably does, and what the decoded map payload
   implies about authored-vs-autonomous behavior. Write down the findings with source basis.
2. Propose the smallest strategic loop that makes a skirmish a game — e.g. a scripted build order +
   periodic raid waves scaling on a timer, issued through the same command queue the human uses
   (determinism: the AI must be a pure function of sim state + seeded RNG, running in the sim, never
   from app-side state).
3. Decide the architectural seat: a sim system per AI player consuming the same content data and
   command seam as the player (golden rules 1 and 3 apply — data-driven, deterministic).
4. File the implementation tickets (each one `/worktree`-sized: e.g. AI command-issuing seam, build
   order execution, raid waves) with the design decisions in their context. Implementing the very
   smallest first slice in the same session is in scope only if the survey lands quickly.

## Verify

- Deliverable check: design decisions have named source basis or named approximation, and every
  proposed implementation step exists as a filed ticket on the branch.
- Any code written obeys sim purity (hygiene test) and per-tick budgets; `npm test`,
  `npm run check`, `npm run build`.
