# Give the player a way to un-pin a builder from a foundation

**Area:** app, sim · **Priority:** P3

A right-click on a foundation pins a builder to it (`assignBuilder` stamps `SiteAssignment { pinned:
true }`, `view/unit-controls/orders.ts`), and `planBuilder` honours that pin over the nearest-site
pick for as long as the site carries `UnderConstruction`. Nothing lets the player take it back: a walk
order does not clear the pin (the builder walks back), and the new "Remove Work Place" control does
not either, because a pin is a `SiteAssignment` and not the `JobAssignment` that control drops. The
only exits are the site finishing, the site being demolished, a trade change, or posting the builder
to a standing building so the workplace rung outranks the builder rung.

The pin is also invisible: the settler panel reads `JobAssignment` for its workplace line, so a pinned
builder shows "no work place" while being steered by a binding the player cannot see or undo.

The original names this control: `humanwindow` 34 is `Remove Building Site` / `Usuń Miejsce Budowy`,
the twin of the 33 `Assign Building Site` that `assignBuilder` implements. The same string-table
evidence justified wiring 32 for the workplace release.

## Scope

An `unassignBuilder` command dropping the pin, plus the control that issues it and a panel line that
shows a pinned builder which site it is bound to. Dropping the pin returns the builder to the
nearest-site rung; it must not change its trade or unbind a workplace it also holds.

Out of scope: changing how `planBuilder` picks a site for an unpinned builder.

## Verify

A sim case per arm (pinned then released goes back to the nearest site; the release leaves trade and
any `JobAssignment` intact), an app case for the control's enablement, and a human pass on the panel
with a builder pinned to a distant foundation.
