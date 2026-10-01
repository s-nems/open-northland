# Add production and progression dependencies to Knowledge

**Area:** app, data · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [knowledge-reference](ingame-ui-knowledge-reference.md)

`game/technology.ts` and the progression data hold the dependencies, but no player view shows them.
The original's technology tree shows the map's buildings, goods and professions in ten sections (food,
animals, wood, clay, stone, ore, druid, warehouse, military, dwellings); each item is locked,
available or not yet available, and its description lists the missing profession, good, preceding
profession or experience.

## Scope

- Design readable graph or list navigation for those sections, with zoom and scroll or a simpler
  equivalent, item details and unmet conditions. Follow the HUD panel rules in `packages/app/AGENTS.md`.
- Derive dependencies and states from verified content and progression probes, not hand-written ids.
- Explain required profession, good, prior profession and experience; tell map restrictions apart
  from unmet requirements.
- Implement it in Knowledge's production-and-progression tab, linked both ways with the encyclopedia
  and the contextual requirement links.
- Keep progression calibration in its own ticket; do not change balance to match a picture.

## Verify

Test known and unmet requirements, map locks, large data, live unlocks and direct links. Inspect real
content, run the content tests for new joins and provide the verified preview.
