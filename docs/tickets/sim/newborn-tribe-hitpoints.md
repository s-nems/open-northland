# Spawn newborn settlers with their tribe's health pool

**Area:** sim, app · **Priority:** P2

`spawnNewborn` always stamps `DEFAULT_SETTLER_HITPOINTS` (300), while `createSettler` resolves the
settler's tribe health pool first. The current app content gives playable tribes 5000 hitpoints, and
`growthSystem` changes only the child's life-stage job: a settler born during play therefore reaches
adulthood with 6% of the health of an otherwise identical spawned adult.

The absence of a readable per-age pool does not justify bypassing the shared per-tribe pool. Human
base health remains an approximation covered by the combat-calibration backlog; this ticket only
removes the inconsistent spawn path.

## Scope

- Resolve newborn health through the same tribe-pool-plus-default rule as `createSettler`, with one
  shared helper rather than a second copy.
- Keep birth RNG consumption and component stamp order unchanged apart from the intentional health
  values.
- Do not rescale health at graduation: a child and adult of one tribe share one pool until source
  evidence establishes age-specific values.
- Remove the app catalog's stale reference to the nonexistent `verify-human-hitpoints` ticket;
  combat calibration already owns fidelity work for the base human pool.

## Verify

Family-system tests cover a tribe with a non-default health pool, the zero/unset fallback, and a born
child retaining the tribe pool through graduation. Run `npm test`, `npm run check`, and `npm run build`;
name any intentional golden hash change.
