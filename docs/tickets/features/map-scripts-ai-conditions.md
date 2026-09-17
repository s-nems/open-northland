# Run the authored AI program of a map's [AIData]

**Area:** pipeline, sim · **Priority:** P2

A scripted computer seat does nothing its map authored: `SPECJALNA: FORTECA` keeps its fortress
garrison standing still where the original's scripted handler creates three soldiers on every pulse
of external flag 2, marches on a besieger's base under `AI_MainTask_Attack`, and holds the
`AI_MainTask_Defend` posts. `SetExternalFlag` already lands in `components/ai-flags.ts`, unread, and
the seat toggles of the section are imported (`MapAiSeat`); the task and condition lines are dropped
by `extractMapScript`. 91 mod maps author the program: 962 `Defend`, 237 `CreateCreatures` and 41
`Attack` tasks among them.

## Scope

- Extract the `AI_MainTask_*`, `AI_SetCondition_*`, `AI_UnitLimit` and `AI_SoldiersDefaultPosition`
  lines into validated IR. The loader's parameter layouts are in `docs/formats/MISSIONS.md` (AI data);
  the lettered fields there still need a reading of the task and soldier-assignment code
  (`an original routine`, `an original routine`,
  `an original routine`, the original) before they are named.
- Run the program per scripted seat on the handler's turn cadence (`AI_NEED_REFILL_TICKS` and its
  seat stagger in `systems/lifecycle/needs`): condition slots with the recheck loop, external flags
  from `ai-flags.ts`, `CreateCreatures` through `spawnSettler`, and `Defend`/`Attack` through the
  existing military commands. Report task kinds without an evaluator through an event, as missions do.
- Preserve slot and task progress through save/load and sub-mission suspension.

## Verify

Unit tests per condition kind and task kind, a save/load round trip, and a headless run of
`SPECJALNA: FORTECA`: the garrison gains soldiers at the castle after the mission script's first
flag pulse, and marches on player 0's base only once its `OnHouseInRange` and `OnCreatureInRange`
conditions hold. Pipeline and content gates on the extraction change.
