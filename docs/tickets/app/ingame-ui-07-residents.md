# Build the direct residents list and actionable filters

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

`button-effects.ts` has no population action in this checkout. The original subjects list provides essential selection and need filters; the existing unposted-settler-roster ticket overlaps one subset.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design the list, search/filter controls, active-filter summary, empty states and selection actions. One click on Mieszkańcy opens the list.
- Include current/possible profession, population groups, homelessness, missing tools/shoes/weapons, marriage and children filters with verified semantics; include qualified but unposted workers.
- Selecting a row selects and centres the resident; provide an explicit action for selecting the filtered group. Define whether the list stays open in the approved design.
- Cover local ownership, removed entities and live changes without selection jumps. Share queries with existing projections rather than inventing sim rules.
- Subsume docs/tickets/app/unposted-settler-roster.md only after its exact cases pass; delete that completed ticket then, not at planning time.

## Verify

Test posted/unposted/jobless people, non-human entities, children, other players, filter combinations and select-all. Inspect large lists and camera/selection behavior on a real map.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
