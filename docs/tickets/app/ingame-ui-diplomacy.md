# Redesign diplomacy with actionable relations and tribute

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

The diplomacy window still uses the legacy canvas layout. It already lists encountered nations,
shows both attitude directions, sends `declareDiplomacy` and `payTribute`, and respects discovery,
map relation flags and command ownership. Replace that presentation with the shared DOM HUD.

## Design review

The [interactive study](../../../packages/app/design/diplomacy/README.md) uses the current HUD
window, foundation, icons and fonts with synthetic data. Owner approval is pending; the study is
not wired to a game session. Follow the HUD panel rules in `packages/app/AGENTS.md` before implementation.

## Scope

- Keep a stable nation list beside the selected nation's directed relations, tribute costs and
  trade offers. Show readable selected, locked, insufficient-stock, pending and rejected states.
- Distinguish map locks, hidden details and observer permissions instead of inferring a lock from
  `canDeclare: false`. Preserve discovery and map visibility rules; do not expose unknown nations.
- Use `declareDiplomacy` for the viewer's direction only. Confirm hostility and an attitude change
  that disables existing offers. Open directly from the beam and return focus on dismissal.
- Show tribute cost, available goods and shortages. Payment uses the host's current `payable`
  answer, not independent comparisons per demand: demands can share an eligible stock class.
  Recheck current state when submitting; suppress repeated payment while awaiting the result.
- In the current sim, trade needs the payer's attitude toward the partner to be `friend`
  (`systems/trade/agreements.ts`). Tribute stock includes eligible goods in finished warehouses
  and workplaces (`systems/missions/tributes.ts`), excludes homes, and may use equivalent food
  forms. Match those contracts; their fidelity is not established by this UI study.
- Retain the separate fidelity investigation in
  [map-scripts-runtime-fidelity.md](../features/map-scripts-runtime-fidelity.md). Do not promise an
  automatic reciprocal attitude change or another reward merely because a tribute was paid.
- Nation locations need separately verified discovery-safe data and original behavior evidence;
  the current row projection does not provide positions. The study adds no map or location action.
- On replacement, remove unreachable canvas window/layout/styles/tests and localize production copy.

## Verify

Test unmet/hidden nations, asymmetric relations, locks and hidden details, observer permissions,
insufficient stock, overlapping demands, repeated payment, command rejection and stock scope.
Inspect ownership and command results in the diplomacy scene and on a real map. Check keyboard
focus, Escape, long names, scrolling, small viewports and HUD scaling; provide a verified preview.
