# Decode the authored vertex colours of `map.dat`

**Area:** pipeline, data, sim, render · **Focus:** `emvc` chunk, script tints · **Priority:** P2

`map.dat` carries an optional `emvc` chunk with the map author's own vertex colour index per cell
(`docs/formats/MAPDAT.md`), which the pipeline does not decode. Five shipped maps use it:
czarnoksieznik_z_szeolu (98% of cells), mroczny_swiat (34%), wielka_kolonizacja_ii (15%, both
variants), walhalla (12%) and oasis_o_plenty (under 1%). Those maps start in daylight instead of their
authored darkness, and the script resets whose only job is to clear it (czarnoksieznik_z_szeolu
mission 1 on victory, mroczny_swiat mission 62's six discs over 12851 of its 12921 dark cells) paint
neutral over neutral.

## Scope

- Verify the chunk layout against the owned copy and document it in `MAPDAT.md`; decode it in the
  pipeline into the decoded map (one palette index per cell, absent when the chunk is empty), with a
  synthetic fixture and an IR bump.
- The sim starts its tint state from the authored indices (per node, as `setVertexColors` paints a
  cell) so a script write replaces them and a save restores them; the map fingerprint covers them.
- The view's script-tint split reads them like script tints, so an authored whole-map darkness
  becomes the scene grade.

## Verify

- Decoder unit tests on the synthetic fixture; `npm run test:content` on the regenerated content.
- On czarnoksieznik_z_szeolu the map starts dark and the victory reset lifts it; on mroczny_swiat
  mission 62 clears the island. Screenshot both before and after.
