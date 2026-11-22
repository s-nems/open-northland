import { executeInstructions, type Matrix, type Renderer, type RenderGroup } from 'pixi.js';

const patchedPipes = new WeakSet<object>();
/** The render groups {@link drawRenderGroup} left out of the renders. */
const undrawn = new WeakSet<RenderGroup>();

/**
 * Leave `group` out of the renders of every renderer {@link inheritParentGroupUniforms} patched, or
 * draw it again. Unlike hiding the group's root, this changes no instruction list and dirties no
 * transform: the parent keeps the group's place and skips it as it draws.
 */
export function drawRenderGroup(group: RenderGroup, draw: boolean): void {
  if (draw) undrawn.delete(group);
  else undrawn.add(group);
}

export function drawsRenderGroup(group: RenderGroup): boolean {
  return !undrawn.has(group);
}

function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.tx === b.tx && a.ty === b.ty;
}

/**
 * Whether `group` would push exactly the global uniforms already bound: Pixi's own push takes the
 * projection, resolution and offset from the current entry and only the transform and colour from the
 * group, so equal ones leave every uniform as it is. Outside a cached-as-texture subtree the pushed
 * transform is the group's world transform. Its `inverseParentTextureTransform` getter must stay
 * unread here: it answers once per frame and returns nothing on a second read.
 */
function drawsInParentSpace(renderer: Renderer, group: RenderGroup): boolean {
  if (group.isCachedAsTexture || group._parentCacheAsTextureRenderGroup) return false;
  const current = renderer.globalUniforms.globalUniformData;
  return (
    current.worldColor === group.worldColorAlpha &&
    sameMatrix(current.worldTransformMatrix, group.worldTransform)
  );
}

/**
 * Renderer-wide, HUD groups included: draw a render group that sits untransformed and untinted in its
 * parent's space (a depth band) without pushing its own global uniforms. Pixi pushes a fresh uniform
 * group per render group and dirties the parent's on the pop, so every batch start after a band
 * re-uploads the same matrices. A group {@link drawRenderGroup} left out draws nothing. Idempotent per
 * renderer.
 *
 * Undocumented Pixi behaviour, verified on pixi.js 8.21, re-verify on a bump: the `renderGroup` pipe's
 * direct path is a push of `inverseParentTextureTransform` and `worldColorAlpha`, the group's
 * instructions, and a pop.
 */
export function inheritParentGroupUniforms(renderer: Renderer): void {
  const pipe = renderer.renderPipes.renderGroup;
  if (patchedPipes.has(pipe)) return;
  patchedPipes.add(pipe);
  const execute = pipe.execute.bind(pipe);
  pipe.execute = (group: RenderGroup) => {
    if (undrawn.has(group)) return;
    if (!drawsInParentSpace(renderer, group)) execute(group);
    else if (group.isRenderable) executeInstructions(group, renderer.renderPipes);
  };
}
