# Re-pin that an AI seat reaches its late build order on a real map

**Area:** sim · **Priority:** P2

Deleting `packages/app/soak/late-goods.soak.ts` removed the only automated check anywhere that an AI
seat gets past its opening build order on a real map. Its two assertions were: standing iron in the
map's deposits falls across the run, and at least one seat completes a smithy.

Nothing cheaper covers this. `packages/app/test/content/ai-map-scenario.test.ts` runs 120 ticks, which
reaches the opening orders only; the sim's AI module tests
(`packages/sim/test/systems/ai-player-modules.test.ts`) prove the workforce rules against synthetic
fixtures, not that a real seat's plan arrives at the gated collector entry. The property needs roughly
18-20k ticks because one construction site at a time gates that entry.

`npm run bench:map` runs the same world at the same horizon but asserts nothing about development: its
window table reports settler and building counts for a reader, and coupling a timing tool to an
economic outcome would make it fail on honest short diagnostic runs.

## Scope

Re-pin both properties at the cheapest layer that can actually hold them. Investigate first whether a
seeded AI-plan test can reach the late entry without simulating 20k ticks (for example by advancing
the plan against a pre-built settlement fixture); fall back to a real-content scenario behind
`npm run test:content` only if it cannot.

## Verify

The chosen test fails when the collector entry is unreachable and passes on current `main`. Run
`npm test`, `npm run check`, and `npm run build`, plus `npm run test:content` if the test lands there.
