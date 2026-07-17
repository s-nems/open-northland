# Cancel a running building upgrade (housewindow 112/113)

**Area:** features (sim + app/HUD) · **Origin:** building-upgrades branch, 2026-07-17 · **Priority:** P3

The manual upgrade flow (the `upgradeBuilding` command: a built chained building re-opens as a
construction site with its inventory stashed in `Upgrading.savedStock`) has no way back: once
started, the only exits are completion or demolish. The original supports cancelling — the decoded
`housewindow` strings pin the surface: 110 "Ulepszenie" / 111 "Rozpocznij ulepszanie budynku" (the
shipped Upgrade button) and **112 "Anuluj Ulepszanie" / 113 "Zatrzymaj ulepszanie budynku"** (the
cancel state of the same button). Source basis: the decoded string table
(`content/gui/strings/<lang>.json`); the cancel's exact *mechanics* in the original (are delivered
materials refunded? does `built` snap back to ONE?) are unobserved — observe the running original
before implementing, or name the chosen behavior as an approximation.

Scope:

- A `cancelUpgrade` sim command: valid only on a building carrying `Upgrading`; restores the
  stashed inventory into the stockpile, removes `Upgrading` + `UnderConstruction`, sets
  `built = ONE` (the old tier still stands — its body never left), and decides what happens to
  already-delivered upgrade materials (refund into the stockpile as surplus is the obvious
  approximation).
- HUD: while `construction !== null && Upgrading` the general section's Upgrade button becomes the
  cancel button (string 112, tooltip 113) — see `sections/building/general.ts` /
  `model/index.ts.upgradable` (currently the button just disappears during the upgrade).
- Fuzz command variant + unit cases mirroring `upgrade.cases.ts`.
