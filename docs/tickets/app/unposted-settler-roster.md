# Show the settlement's trade-ful but unposted settlers

**Area:** app · **Priority:** P3

Staffing is the player's decision in both directions now: `assignWorker` posts a settler and
`unassignWorker` takes it back off (the Praca section's "Usuń Miejsce Pracy" row). What is missing is
the roster - nothing tells the player who is currently trade-ful and unposted.

Three paths produce that state and none of them reports it: an explicit release, a razed workplace
freeing its crew, and `setJob` giving a trade without a post. A gathering trade lands on a work flag
and stays visible on the map, but a producer, carrier or fighter released this way is inert until it
is posted somewhere (`economy/employment-is-directed.test.ts`) and can only be found by clicking it -
idle capacity the player cannot see.

## Scope

A settlement-wide view listing the local player's settlers that hold a trade but no `JobAssignment`:
name, trade, and a click that selects and centres on the settler. The details panel's
`onSelectEntity` / `onCenterOnEntity` seams already do the second half.

The construction window's parchment catalogue (`hud/dom/construction-window.ts`) is the existing
scrollable list surface on the DOM plane; the extras and statistics windows show how a legacy pop-up
is mounted and refreshed. Reading the roster is an O(entities) snapshot scan, so pull it only while
the window is open, the way `stats-window.ts` gates `hudFor`.

Out of scope: any automatic re-employment, and any change to who counts as employed.

The original's own subjects window (`main` 6, "Opens the subjects window") is the nearest reference
and is not decoded, so the window's shape is an approximation. Name it as one.

## Verify

An app case over a synthetic snapshot for the row set (a posted settler, an unposted tradesman, a
jobless settler, another player's settler), and a human pass on the open window.
