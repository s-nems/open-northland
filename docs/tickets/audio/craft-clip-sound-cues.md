# Sound the craft clips against their own stretched clock

**Area:** audio, sim · **Focus:** atomic sound cues · **Priority:** P3

A workshop is silent while its craftsman works. The clips carry the sounds:
`viking_smith_produce_sword_long` authors seven `event <at> 34 <id>` cues over its 240 frames,
`viking_mason_produce_pillar` three over 120, `viking_potter_produce_crockery` one over 80, and both
baker clips two over 200. `soundingClip` (`packages/sim/src/systems/settlers/atomics/sound-cue.ts`)
now refuses every craft atomic outright, because a craft clip is stretched over its workplace's batch
while the cue frames are matched against that batch's clock, and every recipe runs the flat
`DEFAULT_RECIPE_TICKS` (180): the potter's and mason's cues would land early, and the longer clips
would be dropped by the existing `duration < anim.length` guard anyway.

## Scope

- Place a craft clip's cues at the frame its stretch actually reaches - the clip's own frame at the
  atomic's progress, not the raw `event.at` - and lift the length guard for that path only, so the
  clips longer than a batch sound too.
- Leave every other atomic's cue placement exactly as it is; those clips are played frame per tick.
- The cue ids must resolve in the decoded sound bank before this counts as done; check the ones the
  craft clips name rather than assuming they are all present.

## Verify

- Unit: a clip stretched over a longer batch fires each cue once, at the batch tick its own frame maps
  to, and a clip shorter than its batch fires none twice.
- Human ear on a decoded map with a staffed smithy: the hammer falls with the sound, not before it.
