# Glossary

## Original formats

- **bob**: one framed, palette-indexed image inside a `.bmd` container. Named bob ranges form
  animations. See [`formats/GRAPHICS.md`](formats/GRAPHICS.md).
- **`.bmd`**: sprite container used for units, buildings, landscape objects, and interface art.
- **`.cif`**: serialized and encrypted object data used for type tables, map logic, and strings. See
  [`formats/CIF.md`](formats/CIF.md).
- **hoix**: the chunk container inside `map.dat`. Each chunk has a 32-byte header and payload. See
  [`formats/MAPDAT.md`](formats/MAPDAT.md).
- **`.fnt`**: bitmap font wrapper around a bob container. Character `c` uses bob `c - 0x20`.
- **lane**: one grid plane in `map.dat`. Lanes differ in resolution and meaning, so a tag must be
  interpreted before it is joined to terrain or objects.

## World and simulation

- **staggered raster**: the displayed map layout. Odd rows shift by half a cell. The observed native
  pitch is 68 pixels wide and 38 pixels per row.
- **half-cell lattice**: the `2W x 2H` logic grid used by commands, footprints, placement, and
  navigation. See [`ECS.md`](ECS.md#terrain-and-navigation).
- **atomic action**: a numbered unit of settler behavior bound to jobs, goods, tribes, and animation.
- **drive**: one planner decision that may assign a settler's next atomic or movement goal.
- **valency**: a logic node's occupancy capacity from landscape data.
- **logictype**: a numeric join key connecting a graphics record to its logic table row.

## Project terms

- **IR**: the validated JSON rules and presentation bindings generated in `content/ir.json`.
- **ContentSet**: the in-memory value returned by `parseContentSet` after schema and cross-reference
  validation.
- **Fixed / `fx`**: the simulation's branded fixed-point number type and its constructor helpers.
- **golden**: a committed expected state hash or action trace. It moves only with an intentional,
  explained behavior change.
- **team colour**: a player-specific recolour applied while drawing an indexed atlas.
- **skin variant**: a separate palette variant baked during content conversion.
- **independent implementation**: project code written from the permitted evidence in
  [`SOURCES.md`](SOURCES.md), without copied or translated engine code.
