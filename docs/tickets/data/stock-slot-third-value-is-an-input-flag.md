# Read a stock slot's third value as its input flag, not a starting amount

**Area:** data, sim, app · **Priority:** P2

`extractBuildings` (`tools/asset-pipeline/src/decoders/ini/types/buildings.ts`) reads
`logicstock <good> <capacity> <third>` and names the third value `initial`; `StockSlot.initial`
(`packages/data/src/schema/economy/buildings.ts`) carries it, and `placeBuilding`
(`packages/sim/src/systems/command/placement.ts`) seeds that many units into a building as it is
placed.

The value is not an amount. Across the mod's `DataCnmd/types/houses.ini` it is only ever `0` or `1`:
62 of 370 slots carry `1`, spread over 28 types, and every one of them is a good the building
consumes, never one it stores or makes. Some of the set:

| type | slots flagged 1 |
| --- | --- |
| `home level 00`-`04` | 16, 17 (both foods) |
| `work bakery 01` | 1, 11, 12 (water, flour, honey) |
| `work joinery 00`-`02` | 5, 6 (wood, iron); `work joinery 03` adds 9 (leather) |
| `work mason hut 00`-`01` | 3 (stone) |
| `work coin mint` | 5, 6, 7, 16, 43, 41, 34, 38, 30 (everything it melts down) |
| `barracks` | 8 (coin) |

The whole set is `awk '/^debugname/{n=$0} /logicstock/{if($4==1) print n, $0}' houses.ini`. It matches
each type's recipe inputs, plus the consumers with no recipe (a home eats, the barracks pays).
Original behavior, unconfirmed against the running original: the flag is the store's input side, and a
building's own cursor card marks those lines with an inbound arrow and its other lines with an
outbound one.

Consequence: every building we place is born holding one unit of each good it consumes - a free
loaf and drink in every new home, a free water and flour in every bakery - and the input/output
distinction the original shows is not in our content at all, so no surface can mark it.

## Scope

- Rename the field to its meaning in the decoder and in `StockSlot`, and drop the seeding in
  `placeBuilding`. Nothing else may keep reading it as an amount.
- Bump `IR_VERSION` and regenerate the committed fixtures in the same commit, as
  `packages/data/AGENTS.md` requires.
- Mark the input lines where a store is listed: the building hover card
  (`packages/app/src/hud/hover-card/building.ts`) and the details panel's store rows.

## Verify

`npm run test:content` against a regenerated `content/`, plus `npm test` and `npm run check`. A placed
building now starts empty, so any golden that places one moves; regenerate it in the same commit and
name the behavior change there.
