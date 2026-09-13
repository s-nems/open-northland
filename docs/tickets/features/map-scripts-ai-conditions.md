# Connect mission external flags to authored AI conditions

**Area:** pipeline, sim · **Priority:** P2

`SetExternalFlag` persists per-player flags, but no AI-condition consumer reads them. The
[HAI toggles ticket](../pipeline/aidata-hai-toggles.md) explicitly excludes the authored
`AI_MainTask_*` / `AI_SetCondition_*` layer.

## Scope

- Inspect owned `ai.inc` data and original behavior to establish condition slots, activation,
  clearing, task transitions and behavior without an AI handler. Keep unconfirmed readings explicit.
- Extract the authored conditions and tasks needed by a selected intact loose map into validated IR.
- Execute that route deterministically and connect external flags to its conditions. Report unsupported
  task kinds explicitly; retaining a flag alone must not imply that its authored AI behavior works.
- Preserve condition/task progress through save/load and sub-mission suspension and return.
- Update MISSIONS.md with actual support and remaining limitations. Coordinate module permissions
  with the HAI ticket; do not duplicate its extraction scope.

## Verify

Cover activation, clearing, wrong-player isolation, absent handlers and save/load. Demonstrate an
intact loose-map flag triggering its authored AI action. Run normal gates and pipeline/content gates
when extraction changes. Campaign archive extraction is excluded.
