# Give the Byzantine wooden-spear soldier its 20000 hitpoints

**Area:** sim · **Priority:** P3

`HUMAN_HITPOINTS` (`systems/spawn/settlers.ts`) gives every person 5000 hitpoints. Original behavior:
one class is the exception, the Byzantine wooden-spear soldier, whose pool is 20000. The sim names the
gap in the constant's comment and models nothing for it, so a Byzantine spear rush is four times
weaker than in the original.

## Scope

- Carry the exception as data, a per-(tribe, job) hitpoint pool in the content schema with 5000 as the
  default, not as an id rule in a system.
- Apply it wherever the pool is set: spawn, a profession change into or out of the class, and the
  `Health.max` the dying-settler warning and the healing rate read.
- Confirm against the owned copy whether the pool is 20000 on the class alone or also on the
  wooden-spear good when another class equips it.

## Verify

- A unit test: a Byzantine wooden-spear soldier spawns with 20000 and every other class with 5000, and
  a class change moves the pool between them.
- The state-hash goldens: a changed one names the behavior change in its commit.
