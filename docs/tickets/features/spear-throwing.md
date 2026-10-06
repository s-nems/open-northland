# Design a spear-throwing combat feature

**Area:** sim, app, render · **Priority:** P2
**Needs user:** decide how spear throwing works before implementation.

The supplied animation table contains `human_man_Warrior_spear_throw` with 162 frames.
The current spear soldier uses its melee attack. Playing the throw clip alone would not provide
a ranged spear action, so this feature is deferred separately from the animation coverage work.

## Scope

- Which units and spear types may throw, and how the player requests or enables it.
- Range, damage, cooldown and interaction with the ordinary melee attack.
- Whether throwing consumes a spear, how it is replenished, and the unit's appearance afterward.
- Projectile flight, release timing and hit rules.

Do not enable the throw animation until these rules are agreed.

## Verify

Once the design is agreed, add deterministic tests for the command, projectile and equipment rules,
plus a combat scene showing the throw, impact and return to the appropriate weapon state.
