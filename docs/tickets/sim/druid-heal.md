# Let the druid heal its own people

**Area:** sim · **Priority:** P2

The druid (job 30) has no heal: it only produces oil and potions. `atomicanimations.ini` carries the
clip it needs, `viking_druid_heal` (length 60, `event 40 10 1500`: event type 10 sends hitpoints,
here +1500).

Original behavior: a healer looking for work picks the first human of its own player within 20 map
points (10 when the healer is a farmer or herb farmer) whose hitpoints are at or below its max, so
not only a wounded one. It plays the heal clip on that target, and the event adds its whole value
when the target is below its max, so a send may carry the pool past the max, up to the ceiling of
max plus half. A target that is gone ends the task. "First" is
the original's own human order, which the sim has to replace with a named canonical rule, such as
ascending id. The search is centred on a point the healer stores, which may not be where it stands
now; verify what that point is before implementing.

## Scope

- Add the heal task to the druid's work drive, bound through the tribe's `setatomic` rows rather
  than by clip name.
- Apply event type 10 in the atomic executor as a hitpoint send to the task target, under the
  same max-plus-half ceiling the temple blessing uses.
- Scan for the target through the existing spatial index; do not add a pass over every person.

## Verify

- A unit test for the event: a wounded own settler within 20 gains 1500, a full one gains nothing,
  one at 21 map points is not picked.
- A headless scenario: a druid beside a wounded soldier walks over, plays the clip and heals.
