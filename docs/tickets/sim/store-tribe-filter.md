# Audit nearestStoreFor for missing owner/tribe filter before multi-tribe economies

**Area:** sim · **Origin:** gathering-economy plan reconciliation (fix/farmer-carrier-logistics
follow-up), 2026-07-12

`nearestStoreFor` (`packages/sim/src/systems/agents/ai-targets.ts`) has no tribe/owner filter, so a
haul can deliver into an **enemy** store when it happens to be nearest. Harmless in single-tribe
scenes; wrong the moment a multi-tribe economy scene exists.

## Scope

- Audit every economy nearest-X pick (`ai-targets.ts`, `ai-supply.ts`) for the same gap, not just
  `nearestStoreFor`.
- Add the owner filter at the candidate-collection seam (`collectTargets`) so all picks inherit
  it; single-tribe scenes must be unaffected.
- Goldens: single-tribe traces should stay byte-identical (the filter excludes nothing there) —
  treat any move as a red flag.

## Verify

- `npm test` — goldens byte-identical.
- New unit test: two hostile tribes, a carrier never delivers into the enemy store even when
  nearest.
