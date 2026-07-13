# Drive needs drain rates from the extracted atomic animation events

**Area:** sim + pipeline · **Origin:** original-ui plan reconciliation, 2026-07-12 · **Priority:** P2

Needs drain is a named constant stand-in today (`ONE/4096`/tick hunger,
`packages/sim/src/systems/lifecycle/needs.ts`) — NOT the original's per-animation event scale. The
faithful target: the original drains needs via atomic animation `event (type,value)` rows (e.g.
soldier swing = `event 2 1 −20` + `event 2 2 −20`; woman/civilist −100), so drain is
per-activity, not per-tick-uniform, across all four needs (hunger/fatigue/piety/enjoyment).

**Source basis:** atomicanimations.ini event rows (extracted; the combat and gathering lanes
already decode event frames). `CHANGE_ENERGY` bucket 2 = hunger, `CHANGE_CONDITION` bucket 1 =
sleep.

## Scope

- Extract the need-drain events into the IR where missing; map buckets → needs.
- Replace the uniform per-tick drain with event-driven drain plus a small idle baseline (the
  original's idle drain is unreadable → named approximation).
- This changes settler state evolution → **goldens move intentionally**; name the mechanic in the
  commit.

## Verify

- `npm test` with the deliberate golden move isolated to this change.
- `?scene=needs` still starves a fed-nothing settler in a sane time — **user judges the pacing**.
