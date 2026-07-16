# Animate the make-love hearts as a floating particle effect over the house

**Area:** render + app projections · **Origin:** marriage/children feature, 2026-07-16 · **Priority:** P3

The child-making mechanic shows hearts while the resident couple makes love (`MakingLove` on the
home). Today they are three static `Graphics` hearts drawn as part of the retained door-badge stack
(`packages/render/src/gpu/overlays/badge-layer.ts` `makeStack` + `makeHeart`), anchored at the
worker-icon node beside the door — a placeholder, like the coloured badge squares.

Source basis: the original anchors a particle effect at the HOUSE BASE POINT (`logicdefines.inc`
`ATOMIC_ANIMATION_EVENT_TYPE_PARTICEL_EFFECT_HOUSE_BASE_POINT = 36`, fired by the
`*_make_love`/`*_give_birth` animations) and flips the house action overlay to
`HOUSE_ACTION_OVERLAY_TYPE_MAKE_LOVE = 2` — the hearts float and fade over the building, not a
static stack at the door.

Scope:
- Rising/fading animated hearts over the building's own anchor (not the door badge node) while the
  snapshot home carries `MakingLove` — a small dedicated overlay layer (the BadgeLayer retained-pool
  pattern) or a particle pass; keep per-frame cost screen-bounded.
- Remove the `hearts` field from `DoorBadge`/`makeStack` once the dedicated layer draws them.
- Check whether the decoded GUI/effect atlases carry a heart sprite to use instead of vector shapes.

Verify: `?scene=family` — hearts float over the home during the make-love phase; badges elsewhere
unchanged; human eye signs off the look.
