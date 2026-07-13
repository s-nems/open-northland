# Play the tree-falling frames as a render transient on resourceFelled

**Area:** render (+ app content binding) · **Origin:** gathering-economy plan reconciliation,
2026-07-12 · **Priority:** P3

Felled trees swap instantly to stump + trunk. The original has a mid-fall state:
`packages/app/src/content/resource-gfx/stump.ts` binds the debris and notes "the `tree_dead falling`
(logicType 5, the mid-fall frame …) is the falling-animation polish"; `objects.ts` already groups
`'tree falling'` with unshaded types. Pure render polish reacting to the existing `resourceFelled`
event (`packages/sim/src/core/events.ts`) — no sim change.

## Scope

- Resolve the falling-state `[GfxLandscape]` record; on `resourceFelled` draw a short one-shot
  falling sprite at the node before the stump appears.
- Guard on the frames actually being present; degrade to the current instant swap otherwise.

## Verify

- `npm test` — no golden impact (render-only).
- `?scene=gathering`: the tree topples — **user's eyes**.
