# Add tributes: script demands, payment, and the tribute window

**Area:** sim, app · **Focus:** `systems/missions`, HUD · **Priority:** P2
**Blocked by:** [map-scripts-5-economy-and-tech.md](map-scripts-5-economy-and-tech.md)

Map-scripts epic, stage 8 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md),
"Tributes".

Tributes are the campaign's quest currency: `CreateTribute` 986 lines, `AddTributeGoods` 1,118,
`ClearTribute` 821, and `PayTribute` 692 goals across more than 30 maps. Without them those maps
never advance.

## Scope

- Tribute state in the sim: 44 slots with active and paid flags, payer, receiver, description string
  id, and up to five demands; results `CreateTribute`, `AddTributeGoods`, `ClearTribute`; goal
  `PayTribute`.
- A `payTribute` player command that is admitted only when one warehouse or workplace of the payer
  holds every demanded amount, takes the goods, and marks the slot paid; the goods leave the world.
- An app tribute window listing the player's open demands with the description text (from the map
  string table stage 1 emits) and a pay button, following the existing HUD window patterns.
- Non-goals: AI paying tributes.

## Where to look

`packages/sim/src/core/commands/` (command union and admission), `systems/stores`,
`packages/app/src/hud/tool-panel/windows.ts` and the existing window folders,
`packages/app/src/i18n/`.

## Verify

Headless: create, add, refuse payment while short, pay when one house holds everything, goal holds,
clear. A scene registers the window for human review. Coverage delta. Normal gates including
`packages/app`.
