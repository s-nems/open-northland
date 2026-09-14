# Verify the school and barracks classification contract

**Area:** data, sim · **Priority:** P3

`logicSchoolSize` is extracted into `BuildingType.schoolSize` and civilian lessons use it as capacity.
School and barracks still share the training kind and are distinguished by worker-slot shape
(`isBarracksType` and `isSchoolType` in `packages/sim/src/systems/readviews/buildings.ts`).

## Scope

- Verify the semantic discriminator against owned rows and original behavior. Different observed
  capacities (school 5, barracks 25) alone do not establish a stable type discriminator.
- Retain the structural rule if it is justified, or carry a verified content role through the common
  school/barracks predicates. Avoid numeric capacity thresholds invented as type tags.
- Keep fallback content explicit.

## Verify

Cover real school/barracks classification and synthetic missing-capacity content. Run normal gates;
run pipeline/content checks if the schema or extraction changes.
