# Key the collapsed `[GfxHouse]` logic overlays on the tribe

**Area:** pipeline, data, app · **Priority:** P2

`GfxHouseWinners` (`tools/asset-pipeline/src/decoders/ini/buildings-gfx/structure.ts`) collapses each
contested building `typeId` to the lowest `LogicTribeType`, so `ir.buildings` carries one
construction cost, hitpoint pool, and ground footprint per type: the viking one. The record's own
comment names this an approximation. Now that every civilization draws its own building bodies, the
collapse is visible: a saracen palace stands on a viking longhouse's collision body and
build-exclusion ring.

Measured over the mod's plaintext `DataCnmd/budynki12/houses/houses.ini` (115 `[GfxHouse]` sections),
taking each `(typeId, tribe)`'s base build stage the way the collapse does, and counting only the
typeIds at least two tribes declare a value for:

| Key | shared typeIds | tribes disagree |
| --- | --- | --- |
| `LogicWalkBlockArea` | 45 | 39 |
| `LogicBuildBlockArea` | 45 | 33 |
| `logichitpoints` | 45 | 24 |
| `LogicConstructionGoods` | 45 | 5 |

So the collision body and the build-exclusion ring are wrong for a non-viking building on nearly
every shared type, the hitpoint pool on about half, and the build cost on five.

## Scope

- Key the collapsed overlays on `(tribeId, typeId)` and let the consumers resolve a building through
  its own `Building.tribe`, falling back to the base tribe for a type its skin does not describe.
- The footprint reaches the sim (collision, placement, work cells) and the app (`buildingFootprints`,
  the placement overlay), so the join has to travel with the building rather than being read once per
  type at load.
- Decide whether the hitpoint pool is worth per-tribe treatment or belongs with the combat
  calibration work; state the answer in the commit either way.

## Verify

- Extraction tests over a synthetic `[GfxHouse]` fixture carrying two tribes for one typeId.
- `npm run test:pipeline` against the owned copy, then `npm run test:content`.
- A human pass on `?map=wielka_inwazja&player=0`: a saracen building's collision body and the
  build-exclusion ring around it must match the drawn palace, not a longhouse.
