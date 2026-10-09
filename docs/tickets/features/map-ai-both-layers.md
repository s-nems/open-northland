# Run a map's scripted AI program beside the strategic AI

**Area:** sim · **Focus:** `packages/sim/src/systems/ai-program`, `packages/sim/src/systems/ai-player` · **Priority:** P2

A computer seat on a CnMod map runs either the map's `[AIData]` program or the strategic AI's
military, never both: `systems/ai-program` runs only for a seat whose strategic military module is
off, because both would order the same soldiers against each other. Original behavior (a reading,
see "AI data" in `docs/formats/MISSIONS.md`): every computer seat runs both layers side by side, the
program owning its authored Defend posts and Attack bands and the strategic AI the economy and army.
Campaign enemies therefore attack and defend differently from the original wherever a map authors a
program and leaves `HAI_Disable` off (91 of the 121 maps carrying the section author a program).

The seat's raid defence (`ai-player/military/defence`) also orders the program's posted men out at
a raider, and the program orders them back once they stand idle, so a raider in the watch band makes
a posted man pace between the two.

## Scope

- Investigate first: how the original keeps the two layers from claiming the same men (which
  soldiers each layer lists, whether a man taken by a program task is invisible to the strategic
  military), and whether the original runs any raid defence beside the program.
- Run both layers for every computer seat the original runs them for, with one owner per soldier at a
  time, and drop the "military module off" gate.
- Remove the raid-defence and program tug of war in the way the original avoids it.
- Update "AI data" in `docs/formats/MISSIONS.md` with the verified facts.

## Verify

- Sim test: a seat with a Defend post and an enabled strategic military keeps its posted man at the
  post while the strategic AI builds and recruits; a raider in the watch band does not make him pace.
- Real-content scenario on a campaign map that authors a program without `HAI_Disable`: the seat
  both develops its economy and runs its authored attacks; state hash stable across a save/load.
- Normal gates plus `npm run test:content`.
