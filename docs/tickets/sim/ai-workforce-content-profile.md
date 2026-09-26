# Move AI workforce policy into the content profile

**Area:** sim, data · **Priority:** P3
**Blocked by:** [AI build-order profile](ai-build-order-content-profile.md)

Every authored table under `packages/sim/src/systems/ai-player/**` outside the build order itself
(the staffing, supply, collector, clearing, fisher, craft, outfit, army and coverage policies and
the game-phase clocks) lives in sim code as one global default. Once seats select a validated AI
profile, these policies should come from the same profile.

## Scope

- Add each policy to the AI profile schema; a table is found by its `(authored)` label.
- Move the current tables into the committed fallback catalog and resolve every policy through the
  seat's selected profile.
- Keep runtime indexes memoized and free of id-specific branches.

## Verify

- A fixture profile changes each policy without changing the others.
- The default profile preserves current commands and goldens.
- `npm test`, `npm run check`, and `npm run build`.
