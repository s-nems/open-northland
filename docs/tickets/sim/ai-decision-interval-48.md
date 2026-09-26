# Decide each AI seat every 48 ticks instead of 24

**Area:** sim · **Focus:** ai-player · **Priority:** P2

One seat's decision pass (`runAiPlayerModules`, `ai-player/index.ts`) runs its five strategic modules
every `AI_DECISION_INTERVAL_TICKS` (`ai-player/cadence.ts`, 24 ticks, an authored genre-scale cadence).
On the heavy-load reference (`docs/perf/heavy-load-magiczny-las-6ai.md`) those passes are 16 to 19% of
all sim time from 20k ticks on, 13.7 of the 15.8 points in the workforce module, and their cost per
pass grows with the seat's settlement. Halving the pass rate halves that share whatever the passes
themselves cost.

The owner has ruled the slower cadence acceptable for every module, the military one included: combat,
flight, alarms and tower fire run per tick regardless, and the scripted map handlers keep their own
60-tick round (`AI_HANDLER_ROUND_TICKS`). What moves is when the AI notices a shortage, orders the next
building, re-aims a flag or sends a sortie: up to 4 s of game time at speed 1 instead of 2 s, a third
of that at speed 3.

## Scope

- `AI_DECISION_INTERVAL_TICKS` becomes 48. Everything keyed on it follows: the seat slots
  (`aiDecisionDue`), each seat's flag relocation round (`flagRelocateDue`, every 30 decisions, so once
  per 1440 ticks) and any wave or governor timing expressed in decisions rather than ticks. Check each such constant and keep its meaning in ticks where the design intended a clock
  (`WAVE_GATHER_TICKS`, `WAVE_RAMP_TICKS`, the supply governor by game clock).
- Behaviour change: AI goldens, the AI acceptance scenes and every state hash a test pins over an AI
  seat move in the same commit, which names this change.
- Independent of [bounding one seat's pass](ai-decision-tick-slicing.md), which cuts what a pass costs;
  this halves how often it is paid.

## Verify

- `bench:map` for 4000 ticks from the reference's 80k checkpoint before and after
  (`docs/DEVELOPMENT.md`, Measuring performance; `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5`),
  then `npm run bench:compare`: the `aiPlayer` mean falls by about half, its p95 and max unchanged.
- The AI acceptance scenes and the late-game AI tests still build out and field an army; the sortie
  test still answers a raid.
- `npm test`, `npm run check`, `npm run build`.
