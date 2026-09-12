# Implement reward chests and connect map scripts

**Area:** sim, app, pipeline · **Priority:** P2

Landscape placement can display a chest, but there is no reward-chest interaction or payload runtime.
The assistant panel's chest terminology is unrelated to this mechanic.

## Scope

- Verify chest categories, rewards and opening rules against owned readable content and the original.
- Model placed chests and their payload, eligibility, opening and consumption; connect player interaction
  and feedback to the same authoritative sim state.
- Implement ChestNearPos, SetRandomChestOnPosition and SetRandomChestOnRandomPos.
- Use deterministic reward and position selection, with explicit refusal when no valid position exists.
- Preserve unopened payloads and consumed state through save/load, preventing duplicate rewards.
- Integrate technology rewards with the common progression rules; update support and MISSIONS.md.

## Verify

Cover detection, opening, each supported reward category, repeated interaction, blocked placement and
save/load. Review a registered scene showing the interaction and reward. Run the relevant checks,
plus pipeline/content checks if extraction changes.
