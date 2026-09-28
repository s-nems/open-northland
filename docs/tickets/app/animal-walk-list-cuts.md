# Check chicken and bull walk cycle seams

**Area:** app · **Priority:** P3

Animal walking now preserves the authored per-direction frame lists, including the mixed list lengths
used by chickens and bulls. Focused tests cover these lists and the unchanged human block binding.

## Scope

Check the visual cycle seams for the existing chicken and bull bindings.

## Verify

Inspect a chicken and a bull walking on a real map through a full cycle in every direction. Confirm
that no skipped or stray frame appears when each cycle loops. A chicken form has been checked in
`?scene=creature-forms`; the real-map bull and all-direction cycle check remain.

Delete this ticket after that visual check passes. Relevant binding:
`packages/app/src/content/animal-gfx/bindings.ts`.
