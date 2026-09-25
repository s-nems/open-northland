# Keep blank frames as pauses in looping map objects

**Area:** app · **Focus:** content/objects · **Priority:** P3

`pairedStateFrames` (`packages/app/src/content/objects.ts`) drops every 0×0 bob from a state's frame
list. Some records use a blank bob as a pause. The swamp records (`swamp 01`, `swamp 02`,
`ls_water.bmd`) pad with blank bobs 56 and 89. Their state 5 runs 56..89, and their quieter states
are mostly bob 56. With the blanks dropped, every swamp bubbles nonstop and all states look alike.
`fx star` loses 5 of its 16 frames the same way. Maps place about 6300 swamps (68 maps) and 509 stars
(36 maps).

## Scope

- Keep a blank bob as an empty frame that draws nothing for its tick, in the looping map-object path.
- Keep the current drop for lookups that need a drawable frame, such as hit tests and the first still.
- The shore waves and ambient creatures use the same helper; check they stay unchanged.

## Verify

- Unit test: a frame list with blank bobs keeps its length and timing, and a blank frame draws nothing.
- Browser: a swamp placement bubbles with pauses, and different swamp states differ.
