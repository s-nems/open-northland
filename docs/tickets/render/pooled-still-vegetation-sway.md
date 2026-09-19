# Carry the still-tree breeze onto pooled harvestables

**Area:** render, app · **Focus:** gpu/sprite-pool, content/resource-gfx · **Priority:** P3

The environment-motion switch shears the tall trees the original ships as one still frame
(`tree_dead 01`, `tree_dead 02`) through `MapObjectSprite.environmentSway`, which only the static map
layer reads. Both records are wood harvestables (`gatheringPipeline` wood `harvest.gfxIndices` holds
334 and 335). `bindStaticLayer` retires a harvestable's static sprite when it is felled
(`resourceFelled`), and retires all of them when a save is restored (`entries/map/present.ts`, the `restored` branch). The
sprite pool then draws the node, and its `resource` branch in `gpu/sprite-pool/resolve-layers.ts`
shears only by `sheet.families[layer].sway`. So the same map sways on a fresh start and stands still
after a load, and a tree snaps upright by up to about 2.5 px as its fall starts.

A family-level `sway` is the wrong owner: `ls_trees_dead.tree03` also holds `tree_dead 03`,
`tree_dead falling` and the three `tree debris` records. Pooled shadow layers are not sheared at all
today (`layer.shadow ? layer : { ...layer, shear }`), while the static layer leans them with
`castShadowShear`.

Do this only if the user keeps the still-tree sway after the live session.

## Scope

- Key the added sway by gfx index on the resource binding, from the same rule as
  `packages/app/src/content/object-sway.ts`, and apply it in the pool's `resource` branch only while
  the environment-motion switch is on. Own-art family `sway` keeps running regardless.
- Lean the pooled cast shadow with `castShadowShear`, so the pooled and static draws agree.
- Out of scope: flat decor, falling trees, debris, the strength of the breeze.

## Verify

- `resolve-layers` test: a pooled node with a swaying gfx index shears with the switch on and not with
  it off; a node of another gfx index in the same family never shears.
- Browser, `magiczny_las`, `polish=on`: save, load, and compare a dead tree against a fresh boot; fell
  one with a woodcutter and watch for the snap.
- Gates from [TESTING.md](../../TESTING.md).
