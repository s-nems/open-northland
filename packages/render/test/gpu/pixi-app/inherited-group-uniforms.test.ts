import {
  GlobalUniformSystem,
  Matrix,
  type Renderer,
  RendererType,
  type RenderGroup,
  RenderGroupPipe,
} from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  drawRenderGroup,
  drawsRenderGroup,
  inheritParentGroupUniforms,
} from '../../../src/gpu/pixi-app/inherited-group-uniforms.js';

const WHITE_OPAQUE = 0xffffffff;
const HALF_ALPHA_WHITE = 0x80ffffff;

interface GroupShape {
  readonly transform?: Matrix;
  readonly colour?: number;
  readonly renderable?: boolean;
  readonly cachedAsTexture?: boolean;
  readonly underCachedParent?: boolean;
}

function fakeGroup({
  transform = new Matrix(),
  colour = WHITE_OPAQUE,
  renderable = true,
  cachedAsTexture = false,
  underCachedParent = false,
}: GroupShape = {}): RenderGroup {
  return {
    isCachedAsTexture: cachedAsTexture,
    _parentCacheAsTextureRenderGroup: underCachedParent ? {} : null,
    isRenderable: renderable,
    worldColorAlpha: colour,
    worldTransform: transform,
    // Pixi's getter answers once per frame; a read here would leave Pixi's own push without it.
    get inverseParentTextureTransform(): never {
      throw new Error('read before the push');
    },
    instructionSet: { instructions: [{ renderPipeId: 'batch' }], instructionSize: 1 },
  } as unknown as RenderGroup;
}

function harness(current: Matrix) {
  const pushed = vi.fn();
  const drawn = vi.fn();
  const renderer = {
    renderPipes: { renderGroup: { execute: pushed }, batch: { execute: drawn } },
    globalUniforms: { globalUniformData: { worldTransformMatrix: current, worldColor: WHITE_OPAQUE } },
  } as unknown as Renderer;
  inheritParentGroupUniforms(renderer);
  const execute = (g: RenderGroup) => renderer.renderPipes.renderGroup.execute(g);
  return { pushed, drawn, execute, renderer };
}

describe('inheritParentGroupUniforms', () => {
  it('draws a group in its parent space without pushing uniforms', () => {
    const { pushed, drawn, execute } = harness(new Matrix(2, 0, 0, 2, 10, 20));
    execute(fakeGroup({ transform: new Matrix(2, 0, 0, 2, 10, 20) }));
    expect(pushed).not.toHaveBeenCalled();
    expect(drawn).toHaveBeenCalledOnce();
  });

  it('pushes a group whose transform or colour differs', () => {
    const { pushed, drawn, execute } = harness(new Matrix());
    execute(fakeGroup({ transform: new Matrix(1, 0, 0, 1, 5, 0) }));
    execute(fakeGroup({ colour: HALF_ALPHA_WHITE }));
    expect(pushed).toHaveBeenCalledTimes(2);
    expect(drawn).not.toHaveBeenCalled();
  });

  it('leaves a group cached as a texture, or drawn into one, to Pixi', () => {
    const { pushed, drawn, execute } = harness(new Matrix());
    execute(fakeGroup({ cachedAsTexture: true }));
    execute(fakeGroup({ underCachedParent: true }));
    expect(pushed).toHaveBeenCalledTimes(2);
    expect(drawn).not.toHaveBeenCalled();
  });

  it('skips a hidden group it would not push', () => {
    const { pushed, drawn, execute } = harness(new Matrix());
    execute(fakeGroup({ renderable: false }));
    expect(pushed).not.toHaveBeenCalled();
    expect(drawn).not.toHaveBeenCalled();
  });

  it('draws nothing of a group left out, until it is drawn again', () => {
    const { pushed, drawn, execute } = harness(new Matrix());
    const inParentSpace = fakeGroup();
    const pushing = fakeGroup({ colour: HALF_ALPHA_WHITE });
    drawRenderGroup(inParentSpace, false);
    drawRenderGroup(pushing, false);
    execute(inParentSpace);
    execute(pushing);
    expect(drawsRenderGroup(inParentSpace)).toBe(false);
    expect(pushed).not.toHaveBeenCalled();
    expect(drawn).not.toHaveBeenCalled();
    drawRenderGroup(inParentSpace, true);
    drawRenderGroup(pushing, true);
    execute(inParentSpace);
    execute(pushing);
    expect(drawsRenderGroup(inParentSpace)).toBe(true);
    expect(pushed).toHaveBeenCalledOnce();
    expect(drawn).toHaveBeenCalledOnce();
  });

  it('patches each renderer once, and every renderer on its own', () => {
    const first = harness(new Matrix());
    const patched = first.renderer.renderPipes.renderGroup.execute;
    inheritParentGroupUniforms(first.renderer);
    expect(first.renderer.renderPipes.renderGroup.execute).toBe(patched);
    first.execute(fakeGroup({ transform: new Matrix(1, 0, 0, 1, 5, 0) }));
    expect(first.pushed).toHaveBeenCalledOnce();

    const second = harness(new Matrix());
    second.execute(fakeGroup());
    expect(second.drawn).toHaveBeenCalledOnce();
    expect(first.drawn).not.toHaveBeenCalled();
  });
});

/** The Pixi behaviour the patch stands on; a Pixi release that changes either fails here. */
describe("Pixi's render group push", () => {
  it('pushes exactly the group transform and colour on its direct path', () => {
    const transform = new Matrix(2, 0, 0, 2, 10, 20);
    const pushes: unknown[] = [];
    const pops = vi.fn();
    const renderer = {
      globalUniforms: { push: (options: unknown) => pushes.push(options), pop: pops },
      renderPipes: {},
    } as unknown as Renderer;
    const group = {
      isRenderable: true,
      isCachedAsTexture: false,
      inverseParentTextureTransform: transform,
      worldColorAlpha: HALF_ALPHA_WHITE,
      instructionSet: { instructions: [], instructionSize: 0 },
    } as unknown as RenderGroup;
    new RenderGroupPipe(renderer).execute(group);
    expect(pushes).toEqual([{ worldTransformMatrix: transform, worldColor: HALF_ALPHA_WHITE }]);
    expect(pops).toHaveBeenCalledOnce();
  });

  it('gives a push of the bound transform and colour the uniforms already bound', () => {
    const renderer = {
      type: RendererType.WEBGL,
      renderPipes: {},
      renderTarget: {
        renderTarget: { size: [1440, 900] },
        projectionMatrix: new Matrix(2 / 1440, 0, 0, -2 / 900, -1, 1),
      },
    };
    const system = new GlobalUniformSystem(
      renderer as unknown as ConstructorParameters<typeof GlobalUniformSystem>[0],
    );
    const transform = new Matrix(0.35, 0, 0, 0.35, -120.5, 64.25);
    system.start({ worldTransformMatrix: transform, worldColor: WHITE_OPAQUE });
    const bound = structuredClone(system.uniformGroup.uniforms);
    system.push({ worldTransformMatrix: transform.clone(), worldColor: WHITE_OPAQUE });
    expect(structuredClone(system.uniformGroup.uniforms)).toEqual(bound);
    // The comparison sees a transform that differs.
    system.push({ worldTransformMatrix: new Matrix(), worldColor: WHITE_OPAQUE });
    expect(structuredClone(system.uniformGroup.uniforms)).not.toEqual(bound);
    system.pop();
    system.pop();
  });
});
