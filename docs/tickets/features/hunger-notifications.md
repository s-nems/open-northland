# Surface hunger/starvation notifications from the decoded messages strings

**Area:** app + render · **Priority:** P2

Starvation kills ~2.5 min after the hunger bar pins with no map/HUD indication unless the settler
is selected. The decoded `messages` string table ships (`content/gui/strings/pol.json` →
`messages.10 = "jest głodny"`, `messages.11 = "głoduje"`) but is consumed nowhere — app code loads
only the `housewindow`/`humanwindow` tables (`content/gui-gfx.ts`), and no notification/toast
surface exists (the only banner is build-placement).

**Source basis:** messages ids 10/11 are the original's own hunger notifications. Sim triggers are
already exposed: `Settler.hunger`, `HUNGER_EAT_THRESHOLD` (¾ bar,
`packages/sim/src/systems/settlers/drives/needs.ts`), hunger pins at `ONE` before starvation.

## Scope

- A HUD notification seam (new `hud/` surface + bitmap text) wired to the `messages` table.
- Emit "jest głodny" on crossing `HUNGER_EAT_THRESHOLD`, "głoduje" when hunger pins at `ONE`.
- Signal path: prefer a snapshot-side derivation in app (a new sim event would move goldens — only
  add one deliberately if the derivation proves too awkward).

## Verify

- Headless unit test of the threshold→message model.
- Placement and legibility on the wood chrome — **user's eyes**.
