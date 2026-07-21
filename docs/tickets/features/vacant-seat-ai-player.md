# Distinguish scripted, autonomous, idle, and closed map seats

**Area:** sim + app · **Priority:** P2
**Blocked by:** [authored HAI toggles](../pipeline/aidata-hai-toggles.md)

The roster currently reduces every unclaimed seat to Idle or AI. That cannot represent the map's own
HAI configuration, and `PLAYER_TYPE_NONE` seats still spawn their authored entities. Once HAI toggles
are imported, the states have distinct behavior: Script follows the map's module flags, AI enables the
full strategic player, Idle keeps the seat's entities without strategic commands, and Closed removes
the seat from setup.

## Scope

- Model Script/AI/Idle for every visible, unclaimed seat; default authored AI seats to Script.
- Treat authored closed seats as non-participants and do not spawn their entities. They are not a
  fourth player-selectable AI mode.
- Round-trip the selection through the menu URL/setup input and localize the labels.
- Keep claim and observer start gating unchanged.

## Verify

- Menu: the three states cycle with correct authored defaults and round-trip through setup.
- Headless: Script applies the imported HAI flags, AI enables every available module, Idle issues no
  strategic commands, and Closed spawns no owned entities.
- `npm test`, `npm run check`, `npm run build`; browser pass over the menu + an AI-vs-AI start.
