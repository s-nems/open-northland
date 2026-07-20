# Acknowledge a player order the sim refuses

**Area:** packages/app · **Origin:** fix/iron-pickup review battery, 2026-07-20 · **Priority:** P3
**Needs user:** the feedback form (cursor flash, ping, sound) is a visual/audio call only the user can sign off.

A player command the sim declines is invisible. `issueSetWorkFlag`
(packages/app/src/view/unit-controls/orders.ts) enqueues unconditionally, does no client-side legality
check, and the sim's handlers just `return` — no cursor change, no ping at the click point, no line.
The success case *is* visible (the selected gatherer's flag is highlighted via `flaggedFlagIds`,
packages/app/src/view/unit-controls/index.ts, and it visibly moves), so the asymmetry teaches the
player that Ctrl+Right-Click works, then leaves them guessing on the refusal.

This got sharper on fix/iron-pickup: `setWorkFlag` used to drop any click on a resource body — the
common case, and the bug that branch fixed by snapping to the nearest legal node within 6. What
survives is the genuinely-unplaceable click (mid-lake, a walled-in pocket, wholly outside the
settler's signpost area), which now behaves exactly like the bug that was just removed. `moveUnit`
has no destination marker either, so this is a pre-existing genre gap the fix makes more visible
rather than one it introduced.

## Scope

One shared "order refused" acknowledgment at the click point, driven for the orders that can decline:
`setWorkFlag`, `assignWorker`, `assignBuilder`, `placeSignpost`. Cheapest honest form is a brief
cursor/ping flash at the clicked world point; the seam is the app's order issuers, which already know
the click position. Note the sim currently signals refusal only by not acting — decide whether the app
infers it (re-read the snapshot next tick) or the sim gains a rejection event; prefer the former if it
holds, since sim events are render-only by contract and a new event type is the heavier change.

Do not add a client-side legality pre-check that duplicates the sim's rule — the sim stays the
authority, and a second copy of the placement rule would drift.

## Verify

`npm test`, `npm run check`, `npm run build`. Then human sign-off in `?map=magiczny_las`: select a
gatherer, Ctrl+Right-Click mid-lake, and confirm the refusal reads clearly without being noisy on
repeat clicks.
