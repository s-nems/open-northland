# Correct the final sethouse column and preserve its behaviour id

**Area:** pipeline + data · **Priority:** P2

The map decoder exposes the final `sethouse` column as optional `rot`, and `TerrainEntities` documents
it as rotation. The readable corpus contradicts that name: values include 401–405 and mission scripts
address the same numbers with `SetHouseBehaviourFlag`; many stores and headquarters use 1000-series
ids. Generated map JSON contains 4,014 such values, but the app drops them.

## Scope

- Confirm the identifier semantics against `staticobjects.inc`, mission scripts, and any readable
  command declarations in the allowed sources.
- Rename the decoded/schema field to a semantics-accurate name such as `behaviourId`; do not translate it
  to facing.
- Attach it to authored building state under a semantics-accurate component/read view and include it in
  snapshots, so script commands can address a house without coordinate heuristics. Interpreting mission
  commands is out of scope.
- Add a migration policy for locally generated old map JSON, or make the schema error explain that
  content must be regenerated.

## Verify

Synthetic decode and schema tests pin zero and nonzero ids, and a real-content test matches a house id
used by `SetHouseBehaviourFlag`. Run normal gates plus `npm run test:pipeline` and `npm run test:content`.
