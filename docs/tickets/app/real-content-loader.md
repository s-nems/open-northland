# Add a validated real-content loader: loadRealContent(): ContentSet

**Area:** app · **Origin:** global-content plan reconciliation, 2026-07-12 · **Priority:** P1

First link of the real-content chain (→ [real-content-rekey](real-content-rekey.md) →
[real-content-balance-overlay](real-content-balance-overlay.md) →
[real-content-tuning-rebind](real-content-tuning-rebind.md) →
[real-content-switch](real-content-switch.md) → [real-content-goldens](real-content-goldens.md)).

Prerequisite: `content/ir.json` is a generated, gitignored artifact — run
`npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content` (or copy
`content/` from the primary checkout) first. The ir.json-derived numbers below were verified
2026-07-12 and need re-checking after regeneration.

The schema skew is resolved: `parseContentSet(content/ir.json)` passes (verified 2026-07-12 — 65
goods / 55 buildings / 55 jobs / 41 tribes, zero errors). But no loader exists: `loadIr()`
(`packages/app/src/content/ir.ts`) returns the graphics/atlas `ContentIr` view, not a validated
`ContentSet` for the sim. The sim stays pure — content is injected at the app boundary
(`packages/app/AGENTS.md`).

## Scope

- One memoized loader (mirroring `loadIr`) that reads `content/ir.json` — browser `fetch`, Node
  `readFileSync` for tests/slice — and returns `parseContentSet(raw)`.
- A test asserting the full 65-good / 55-building set comes back.
- Do NOT wire it into the sim yet.

## Verify

- New app test; `npm test` + `npm run check` + `npm run build` green.
