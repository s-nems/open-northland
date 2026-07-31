# Import the authored map lanes the map stage still drops

**Area:** pipeline + sim · **Priority:** P3

The map stage decodes the terrain, dictionary, and landscape lanes but drops four chunks that carry
authored, non-derivable map content (meanings in `docs/formats/MAPDAT.md`, "Lanes not imported"):

- `lafm` fish swarms: a fixed 500-slot table of position, fish count, and continent id. Maps with
  authored fishing grounds import without them.
- `lmlp` per-node owner and palette for pre-placed stockades and gates. Maps that ship player-owned
  walls import them unowned.
- `emmi` road-overlay type per half-cell node. Authored roads vanish.
- `emvc` per-cell vertex colors (optional chunk). Authored tinting is lost.

## Scope

- Decode `lafm` and `lmlp` first: both feed sim state (fish stocks, ownership) and their consumers
  exist or are cheap to join. Confirm each lane's byte layout against the owned corpus before
  trusting the community-documented shape.
- `emmi` and `emvc` are render-only; import them together with their first consumer instead of
  emitting dead lanes.

## Verify

Synthetic chunk fixtures per lane, `npm run test:pipeline` shape checks against the owned corpus,
and for `lafm`/`lmlp` a real-content join test via `npm run test:content`.
