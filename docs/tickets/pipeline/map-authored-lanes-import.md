# Import authored fish swarms and fortification ownership

**Area:** pipeline, sim · **Priority:** P3

The map stage drops two authored lanes that already have direct sim consumers:

- `lafm` fish swarms: a fixed 500-slot table of position, fish count, and continent id. Maps with
  authored fishing grounds import without them.
- `lmlp` per-node owner and palette for pre-placed stockades and gates. Maps that ship player-owned
  walls import them unowned.
## Scope

- Decode `lafm` into fish stocks and `lmlp` into fortification ownership and palette.
- Confirm both byte layouts against the owned corpus before trusting the community-documented shape.
- Leave render-only `emmi` and `emvc` unimported until their first consumer is scheduled.

## Verify

Synthetic chunk fixtures per lane, `npm run test:pipeline` shape checks against the owned corpus,
and for `lafm`/`lmlp` a real-content join test via `npm run test:content`.
