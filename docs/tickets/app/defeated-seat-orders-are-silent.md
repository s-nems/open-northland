# Tell a defeated seat that its orders are refused

**Area:** app · **Focus:** `packages/app/src/hud/tool-panel`, `packages/app/src/view/runtime` · **Priority:** P2

`seatMayIssue` (`packages/sim/src/systems/command/authority.ts`) refuses every command from a seat the
match marked dead. The HUD does not know: after the verdict panel is dismissed with "Obserwuj dalej",
the strip still opens the build menu, `seatPlacementProbe` still paints the ghost green
(`packages/app/src/view/runtime/placement-gates.ts` has no death check), unit selection still works, and
the click enqueues a command the sim drops without a word. Defeat leaves women and children alive, so
the player has entities to select and a whole HUD that contradicts the one line the panel showed once.

That is an action that neither succeeds nor explains its refusal - the same defect class as
[contested ground](./contested-ground-feedback.md) and [razed fields](./field-razed-feedback.md).

## Scope

- Read the local seat's defeat once per frame from `Simulation.matchOutcome` and carry it into the HUD
  as one state, rather than testing it at each call site.
- In that state the order-issuing surfaces refuse visibly: the build and goods menus and the unit
  command controls read as unavailable, and placement mode cannot be entered.
- A standing line tells the player why, localized in both catalogs, so the reason survives dismissing
  the verdict panel.
- Camera, minimap, the mission sheet and the system menu keep working: a defeated seat watches.

## Verify

- Headless: with the local seat dead, the placement probe refuses and the tool-panel controller reports
  the command surfaces unavailable.
- Browser `?scene=victory`: lose, dismiss the panel, then confirm the build menu, a unit order and a
  placement click all refuse visibly, and that the standing line is readable at 0.75 and 1.25 UI scale.
