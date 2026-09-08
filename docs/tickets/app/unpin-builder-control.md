# Show a pinned builder which foundation it is bound to

**Area:** app · **Priority:** P3

The player can now pin a builder to a foundation (`assignBuilder`) and take the pin back (the ring's
"Remove Building Site" → `unassignBuilder`), but the settler panel still reads its workplace line off
`JobAssignment` alone. A pinned builder therefore shows "no work place" while being steered by a
binding the player cannot see, and nothing on the panel says the release button will do anything.

## Scope

A settler-panel line naming the site a `SiteAssignment { pinned: true }` binds the builder to, using
the same building label the workplace line uses. Leave the unpinned crew membership out: that one is
the builder drive's own per-pass bookkeeping, not a player binding.

## Verify

A panel-model case for the pinned and unpinned shapes, and a human pass with a builder pinned to a
distant foundation.
