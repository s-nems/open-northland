# Extract the building school size and use it to classify barracks

**Area:** pipeline, data, sim · **Priority:** P3

The barracks and school share `logicmaintype 4`. `isBarracksType` distinguishes them by the worker
slots declared only by the barracks, although `houses.ini` carries the direct field: `logicSchoolSize`
is 25 for the barracks and 5 for the school.

## Scope

- Extract `logicSchoolSize` into `BuildingType` with its source provenance.
- Classify the two LEARN buildings from that field instead of worker-slot shape.
- Keep synthetic content explicit; do not infer a school size when the source omits it.

## Verify

- Synthetic and real pipeline tests pin the two values and the case-sensitive key.
- Barracks training tests reject the school and accept the barracks.
- `npm run test:pipeline`, `npm test`, `npm run check`, and `npm run build`.
