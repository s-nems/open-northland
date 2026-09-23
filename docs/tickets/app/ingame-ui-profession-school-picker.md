# Redesign profession and school choices

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

The profession picker uses independent wood styling and the school uses the generic overlay dialog.
Both should use the runtime HUD foundation. This is a bounded part of
[resident details](ingame-ui-08-settler-details.md), not the whole resident-panel redesign.

## Design for review

[Interactive candidate](../../design/ingame-menu/professions.html) imports the runtime `createHudWindow`,
HUD plane, fields, buttons, glyphs and foundation art. Serve it with Vite from the repository root;
it needs module transformation and cannot run on the static mockup server.

```bash
npx vite --config docs/design/ingame-menu/professions.vite.mjs
```

Open `/docs/design/ingame-menu/professions.html`. The preview uses representative data and does not
submit commands. Review school, profession change, collector, mixed selection, early discovery,
full/empty lists, long labels, keyboard focus and UI scaling. Visual approval is pending.

## Scope

- Keep the compact two-column list, small header, alphabetical order within groups, hidden unknown
  choices and immediate selection. Search receives focus immediately on every open and filters choice labels by prefix.
- Reuse the shared HUD window and foundation styles; promote the accepted choice layout into the
  common foundation rather than keeping a separate production stylesheet.
- Preserve main's discovered-profession filter and live eligibility checks when integrating this branch.
- Show professions first. A click completes the choice immediately with zero or one advanced method;
  more than one discovered advanced method opens a separate method window. Selecting a method
  completes the choice with one click. Dismissal returns to professions without submitting.
- Remove the bottom action-description strip. Keep unavailable reasons on the controls.
- School method selection must work for a civilian without first learning/changing to the profession.
  Basic production does not count toward the advanced-method choice. Cover basic plus long sword
  (immediate long-sword course) and all three smith methods (choose long sword, chainmail or plate).
  A course grants only the selected advanced method; verify the resulting basic profession qualification
  through the simulation command path, and fix any prerequisite mismatch rather than hiding the course.
- Verify per-person eligibility for the selected method, including mixed selections.
- Use authoritative capacity, qualification and refusal probes. Current/learned choices cannot submit;
  reasons must be available to mouse and keyboard without expanding every row.
- Keep scrolling inside the list, retain focus and scroll during live updates, dismiss with Escape,
  restore trigger focus, respect HUD scaling and prevent clicks from reaching the world.
- Preserve command envelopes, ownership checks, school lifecycle and selection restoration. Remove
  legacy styling only where it has no remaining consumers.

## Verify

Follow the [panel workflow](../../design/ingame-menu/README.md). Review the concrete candidate before
runtime wiring. Then run standard gates, focused discovery/course tests and browser checks for
selection, cancellation, long lists, live discovery, unavailable courses and removed learners/schools.
The candidate alone does not prove runtime behavior.
