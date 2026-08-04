# Decide what needs mean on a seat the map gives no buildings

**Area:** sim · **Priority:** P2

`needsSystem` raises hunger on every person of a tribe that declares trades, and `planNeeds` answers it
from a store on the eater's own player side or a wild berry bush (`settlers/targets/food.ts`). A seat the
map places with no buildings has neither, so its units pin at `ONE` and starve out around tick 8000.

Counted over `content/maps/`: seats with zero buildings hold **2519 civilization units** (plus 1892
monsters, which `needsSystem` already exempts). It is not only AI garrisons - `gringo_sub.json` seat 0 is
the human seat, with 197 byzantines/franks/saracens and no buildings at all.

The result a player sees on `gringo_sub` is one army obeying two rules: the 51 weresnakes are hunger-proof
by tribe, the 197 civilians beside them die. The monster exemption did not cause this - the civilization
half behaves the same before the `Person` marker branch - but it made the split visible.

## Scope

- Decide the rule for a buildingless seat, at the world or scenario layer rather than per tribe.
  `needsEnabled`/`setNeedsEnabled` already exists as the world-level switch and is the likely seam.
- Whatever is chosen, the two halves of one seat must obey it alike.

## Verify

- A headless scenario over a buildingless seat, asserting the chosen rule at tick 13000.
- `npm test`; `npm run test:content` for the decoded-map counts.
- Player-visible: name the map and what the player should see happen to a buildingless garrison.
