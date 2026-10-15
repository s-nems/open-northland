# Draw the scripted import marker over a marked person

**Area:** render · **Focus:** campaign fidelity · **Priority:** P2

`SetImportHumanFlag` sets behaviour bit 7 (`MISSION_BEHAVIOUR.IMPORTED`) and the sim stores it, but
nothing reads it, so the person a campaign points at looks like any other. Campaign scripts use it as
the "go to this person" tell: the first Asgard stage sets it on the druid when the village is found,
clears it once Bjarni reaches him, then sets it on the shipbuilder, and other campaign stages use it the
same way. Without it the player has only the briefing sentence (look on the northern road) and the goal
"Talk to the druid", and a person standing among others is easy to miss.

Original behavior (reading, unconfirmed against the running original): a person with bit 7 set wears
one extra icon in the column of icons drawn above his head, the column that also holds the experience
stars and the life bar. It is icon 10 of that icon sheet (stars are 6 to 9, life bars 11 to 21), drawn
in the sheet's own palette and stacked 16 px above the icons below it. A hero does not wear it, except
Xena. It is drawn only where the person himself is drawn, so fog hides it; the map overview shows no
such mark.

## Scope

- Investigate first: identify the over-head icon sheet in the data pack and decode icon 10 into the
  render content. Cite the sheet and the frame index in the code.
- Read bit 7 from the snapshot the way `unit-readers.ts` reads `GLOWS`, apply the hero exemption from
  the job row, and draw the icon above the person in a screen-bounded layer (`entity-anchor.ts`
  anchoring, retained per visible person as `heart-layer.ts` does).
- Name the stacking against the life heart and group badges as an approximation until the original's
  stars and life bars are drawn too.

## Verification

- A render-data unit test: a person with bit 7 and a non-hero job yields a marker, a hero does not,
  clearing the bit removes it.
- Asgard stage 1 with missions on: walk Bjarni toward the village until briefing page 1 opens, then
  scroll north to the druid; he wears the marker, and it is gone after Bjarni reaches him.
