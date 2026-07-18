# Show the stashed pre-upgrade inventory while an upgrade runs

**Area:** app/HUD · **Origin:** building-upgrades merge review, 2026-07-18 · **Priority:** P3

During an upgrade the details panel swaps to the construction window and the stashed pre-upgrade
inventory (`Upgrading.savedStock`) surfaces nowhere in the app — the player watches their stored
goods vanish from every UI for the duration and cannot verify the stash survives (it does: the sim
restores it on completion and on cancel). The original's housewindow keeps both surfaces visible —
a "Miejsce Budowy" tab (string 3) beside the "Magazyn" tabs (5/6) — so the two stores never read as
one disappearing.

Scope: surface the stash while `Upgrading` is on — a read-only stored-goods row/section beside the
construction bill (snapshot needs to expose the stash: today only the sim components carry it), or
at minimum a "goods stored safely, restored on completion" line. Source basis: the decoded string
table pins the tab names; the exact original layout during an upgrade is unobserved — check the
running original or name the chosen surface as an approximation.
