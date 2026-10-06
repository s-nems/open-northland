import {
  type BatchableElement,
  Container,
  Graphics,
  type InstructionSet,
  Rectangle,
  type Renderer,
  RendererType,
  RenderGroupSystem,
  Sprite,
  SpritePipe,
  Texture,
  TextureSource,
} from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DepthSortedLayer } from '../../src/gpu/depth-sorted-layer.js';
import { QuadStore } from '../../src/gpu/still-mesh/quad-store.js';
import { StillSpriteMesh } from '../../src/gpu/still-mesh/still-mesh.js';
import { installWorldBatcher, WORLD_VERTEX_SIZE, worldBatched } from '../../src/gpu/world-batcher.js';

/**
 * The still mesh draws the still children of the depth-sorted layer in exactly the painter order Pixi's
 * own batches would, each sprite once. The harness runs Pixi's real render-group update (transforms,
 * validation, instruction builds, renderable updates) over a renderer whose GL is replaced by records:
 * a Pixi batch records the sprites it was handed, a mesh draw names its slots.
 */

/** The texture slots a world batch binds, the renderer limit a world batcher is built for. */
const MAX_BATCH_TEXTURES = 16;
/** Depths this far apart always file into different bands. */
const FAR = 10_000;
const PAGE_SIZE = 64;

interface Recorded {
  readonly renderPipeId: string;
  readonly sprites?: readonly Container[];
}

/** A Pixi batch as the fake batch pipe records it: the sprites, in packing order. */
function fakeRenderer(): Renderer {
  let pending: Container[] = [];
  const fakeBatcher = { updateElement: () => {}, checkAndUpdateTexture: () => true };
  const flush = (instructionSet: InstructionSet): void => {
    if (pending.length === 0) return;
    instructionSet.add({ renderPipeId: 'pixiBatch', sprites: pending } as Recorded as never);
    pending = [];
  };
  const renderer = {
    uid: 1,
    type: RendererType.WEBGL,
    _roundPixels: 0,
    limits: { maxBatchableTextures: MAX_BATCH_TEXTURES },
    buffer: { updateBuffer: () => undefined },
    renderPipes: {
      batch: {
        buildStart: () => {
          pending = [];
        },
        addToBatch: (element: BatchableElement & { renderable: Container }) => {
          element._batcher = fakeBatcher as never;
          pending.push(element.renderable);
        },
        break: flush,
        buildEnd: flush,
        upload: () => {},
      },
      blendMode: {
        buildStart: () => {},
        buildEnd: () => {},
        pushBlendMode: () => {},
        popBlendMode: () => {},
      },
      // A Graphics records like a sprite: in the run Pixi would draw it in.
      graphics: {
        addRenderable: (graphics: Container) => {
          pending.push(graphics);
        },
      },
      colorMask: { buildStart: () => {} },
      renderGroup: {
        addRenderGroup: (group: unknown, instructionSet: InstructionSet) =>
          instructionSet.add({ renderPipeId: 'renderGroup', group } as never),
      },
      sprite: undefined as unknown as SpritePipe,
    },
  };
  renderer.renderPipes.sprite = new SpritePipe(renderer as unknown as Renderer);
  return renderer as unknown as Renderer;
}

interface Harness {
  readonly layer: DepthSortedLayer;
  readonly mesh: StillSpriteMesh;
  readonly held: Set<Container>;
  /** One frame of Pixi's render-group update; returns the sprites drawn, in painter order. */
  frame(): Container[];
  /** The mesh draws of the last frame. */
  meshDraws(): number;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) if (!h.layer.destroyed) h.layer.destroy({ children: true });
});

interface MeshInternals {
  readonly bands: Map<Container, { members: { quads: { slot: number; sprite: Sprite; live: boolean }[] }[] }>;
  readonly store: QuadStore | null;
}

/** A harness meshing every run whatever it saves, or at the given payoff. */
function harness(runPayoff = 0): Harness {
  const renderer = fakeRenderer();
  const system = new RenderGroupSystem(renderer) as unknown as {
    _updateRenderGroups(group: Container['renderGroup']): void;
  };
  const layer = new DepthSortedLayer();
  layer.isRenderGroup = true;
  const held = new Set<Container>();
  const mesh = new StillSpriteMesh((child) => held.has(child), runPayoff);
  layer.stills = mesh;
  let draws = 0;
  const h: Harness = {
    layer,
    mesh,
    held,
    meshDraws: () => draws,
    frame() {
      system._updateRenderGroups(layer.renderGroup);
      const bySlot = new Map<number, Sprite>();
      for (const state of (mesh as unknown as MeshInternals).bands.values())
        for (const member of state.members)
          for (const quad of member.quads) bySlot.set(quad.slot, quad.sprite);
      const drawn: Container[] = [];
      draws = 0;
      for (const band of layer.renderGroup.instructionSet.instructions.slice(
        0,
        layer.renderGroup.instructionSet.instructionSize,
      ) as unknown as { group?: Container['renderGroup'] }[]) {
        const group = band.group;
        if (group === undefined) continue;
        const set = group.instructionSet;
        for (let i = 0; i < set.instructionSize; i++) {
          const instruction = set.instructions[i] as unknown as Recorded & {
            start?: number;
            size?: number;
            batcher?: { indices: Uint32Array };
          };
          if (instruction.renderPipeId === 'pixiBatch') drawn.push(...(instruction.sprites ?? []));
          else if (instruction.batcher !== undefined && instruction.start !== undefined) {
            draws++;
            const indices = instruction.batcher.indices;
            const end = instruction.start + (instruction.size ?? 0);
            for (let q = instruction.start; q < end; q += 6) {
              const sprite = bySlot.get((indices[q] ?? 0) / 4);
              if (sprite === undefined) throw new Error('a mesh draw names a slot no live quad holds');
              drawn.push(sprite);
            }
          }
        }
      }
      return drawn;
    },
  };
  harnesses.push(h);
  return h;
}

const pages = Array.from(
  { length: MAX_BATCH_TEXTURES + 4 },
  () => new TextureSource({ width: PAGE_SIZE, height: PAGE_SIZE }),
);
const textureOn = (page: number): Texture => {
  const source = pages[page];
  if (source === undefined) throw new Error(`no page ${page}`);
  return new Texture({ source, frame: new Rectangle(0, 0, PAGE_SIZE / 2, PAGE_SIZE / 2) });
};

/** A pooled-entity-like container at `depth` with a shadow and a body sprite. */
function entity(layer: DepthSortedLayer, depth: number, page = 0): Container {
  const container = new Container();
  container.zIndex = depth;
  container.position.set(depth % 100, depth / 10);
  for (const p of [page, page + 1]) container.addChild(worldBatched(new Sprite(textureOn(p))));
  layer.addChild(container);
  return container;
}

/** Pixi's painter order over the layer: bands, then their displayed children, then the views in them. */
function painterOrder(layer: DepthSortedLayer): Container[] {
  const out: Container[] = [];
  const walk = (node: Container): void => {
    if (!node.visible) return;
    if (node instanceof Sprite || node instanceof Graphics) out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const band of layer.children) walk(band);
  return out;
}

/** A world batcher packing as the batches do, to compare a slot with. */
const packer = new (installWorldBatcher())({ maxTextures: MAX_BATCH_TEXTURES });

/** The floats `sprite`'s slot holds in the mesh. */
function packedOf(h: Harness, sprite: Sprite): number[] {
  const internals = h.mesh as unknown as MeshInternals;
  const quad = [...internals.bands.values()]
    .flatMap((state) => state.members)
    .flatMap((member) => member.quads)
    .find((q) => q.sprite === sprite && q.live);
  if (quad === undefined || internals.store === null) throw new Error('expected a meshed sprite');
  const start = QuadStore.start(quad.slot);
  return [...internals.store.f32.slice(start, start + 4 * WORLD_VERTEX_SIZE)];
}

/** The floats a world batch packs for `sprite` now, at the texture slot its record names. */
function freshPack(h: Harness, sprite: Sprite): number[] {
  const renderer = (h.mesh as unknown as { renderer: Renderer }).renderer;
  const pipe = renderer.renderPipes.sprite as unknown as { _getGpuSprite(s: Sprite): BatchableElement };
  const element = pipe._getGpuSprite(sprite);
  const out = new Float32Array(4 * WORLD_VERTEX_SIZE);
  packer.packQuadAttributes(element as never, out, new Uint32Array(out.buffer), 0, element._textureId);
  return [...out];
}

describe('StillSpriteMesh', () => {
  it('draws still runs between the others in Pixi painter order, each sprite once', () => {
    const h = harness();
    const order = [0, 1, 2, 3, 4, 5, 6].map((i) => entity(h.layer, i * 3));
    const far = entity(h.layer, FAR);
    for (const i of [0, 1, 3, 4, 6]) h.held.add(order[i] as Container);
    h.held.add(far);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    // Runs [0,1], [3,4], [6] in the first band, [far] in the second.
    expect(h.meshDraws()).toBe(4);
    expect(h.mesh.quadCount).toBe(12);
  });

  it('keeps a meshed sprite current through Pixi updates without a rebuild', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    entity(h.layer, 5);
    h.held.add(tree);
    h.frame();
    const body = tree.children[1] as Sprite;
    body.position.set(7, 3);
    body.tint = 0x808080;
    expect((tree.parent as Container).renderGroup.structureDidChange).toBe(false);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
  });

  it('repacks a sprite that changed in the frame its band rebuilds', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    h.held.add(tree);
    h.frame();
    const body = tree.children[1] as Sprite;
    body.position.set(40, 9);
    body.texture = textureOn(3);
    entity(h.layer, 1);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
    // The container moving takes every sprite of it along.
    tree.position.set(12, 30);
    entity(h.layer, 2);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
  });

  it('moves a sprite to Pixi when its new page does not fit the band table', () => {
    const h = harness();
    const tree = entity(h.layer, 0, 0);
    h.held.add(tree);
    // Fill the band's table with pages of other stills.
    for (let p = 2; p < MAX_BATCH_TEXTURES; p += 2) h.held.add(entity(h.layer, 1 + p / 100, p));
    h.frame();
    (tree.children[1] as Sprite).texture = textureOn(MAX_BATCH_TEXTURES + 2);
    expect(h.frame()).toEqual(painterOrder(h.layer));
  });

  it('applies several deltas between two frames without dropping or doubling a sprite', () => {
    const h = harness();
    const items = [0, 4, 8, 12, 16, 20].map((d) => entity(h.layer, d));
    for (const item of items) h.held.add(item);
    expect(h.frame()).toEqual(painterOrder(h.layer));

    // One stops holding still and changes frame, one moves to another band, one is removed, one hides,
    // a new still one arrives and a mover walks between two stills.
    const [worked, migrant, removed, hidden] = items as [Container, Container, Container, Container];
    h.held.delete(worked);
    (worked.children[1] as Sprite).texture = textureOn(2);
    migrant.zIndex = FAR;
    h.layer.removeChild(removed);
    h.held.delete(removed);
    hidden.visible = false;
    h.held.add(entity(h.layer, 9));
    entity(h.layer, 13);
    const drawn = h.frame();
    expect(drawn).toEqual(painterOrder(h.layer));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn).not.toContain(removed.children[0]);
    // The worked item stayed meshed: no structure change reached its band... until one does.
    worked.zIndex = 17;
    expect(h.frame()).toEqual(painterOrder(h.layer));
  });

  it('stops drawing a meshed sprite hidden on its own', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    entity(h.layer, 5);
    h.held.add(tree);
    h.frame();
    (tree.children[0] as Sprite).visible = false;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(1);
  });

  it('draws a sprite of a meshed child once it is shown again', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    entity(h.layer, 5);
    (tree.children[0] as Sprite).visible = false;
    h.held.add(tree);
    h.frame();
    expect(h.mesh.quadCount).toBe(1);
    (tree.children[0] as Sprite).visible = true;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(2);
  });

  it('hands a meshed child to Pixi when its hidden Graphics layer shows', () => {
    const h = harness();
    const marked = entity(h.layer, 0);
    const mark = worldBatched(new Graphics().rect(0, 0, 4, 4).fill(0xffffff));
    mark.visible = false;
    marked.addChild(mark);
    h.held.add(marked);
    h.frame();
    expect(h.mesh.quadCount).toBe(2);
    mark.visible = true;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(0);
  });

  it('draws a layer inserted into a meshed child', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    h.held.add(tree);
    h.frame();
    // An insertion moves no tick of the container, unlike addChild.
    tree.addChildAt(worldBatched(new Sprite(textureOn(2))), 0);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(3);
  });

  it('hands a child to Pixi when a sprite takes a page the mesh cannot draw as its band rebuilds', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    h.held.add(tree);
    h.frame();
    const straight = new TextureSource({
      width: PAGE_SIZE,
      height: PAGE_SIZE,
      alphaMode: 'no-premultiply-alpha',
    });
    (tree.children[1] as Sprite).texture = new Texture({ source: straight });
    entity(h.layer, 5);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(0);
  });

  it('leaves a child with a non-sprite layer to Pixi', () => {
    const h = harness();
    const marked = entity(h.layer, 0);
    marked.addChild(new Graphics().rect(0, 0, 4, 4).fill(0xffffff));
    h.held.add(marked);
    h.frame();
    expect(h.mesh.quadCount).toBe(0);
  });

  it('frees the slots of a removed still child and of a destroyed layer', () => {
    const h = harness();
    const a = entity(h.layer, 0);
    const b = entity(h.layer, 1);
    h.held.add(a);
    h.held.add(b);
    h.frame();
    expect(h.mesh.quadCount).toBe(4);
    h.layer.removeChild(a);
    h.frame();
    expect(h.mesh.quadCount).toBe(2);
    h.layer.destroy({ children: true });
    expect(h.mesh.quadCount).toBe(0);
  });

  it('meshes a run only once its band rebuilds often enough for its quads to pay for its draws', () => {
    const h = harness(1);
    const big = Array.from({ length: 8 }, (_, i) => entity(h.layer, i));
    const small = entity(h.layer, 20);
    for (const item of [...big, small]) h.held.add(item);
    entity(h.layer, 10);
    // The first rebuild knows no rate: everything draws through Pixi.
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(0);
    // A rebuild every frame: the 16-quad run pays, the 2-quad run does not reach its payoff of the
    // estimated frames between rebuilds yet.
    const band = big[0]?.parent;
    if (band === null || band === undefined) throw new Error('expected a band');
    for (let i = 0; i < 12; i++) {
      band.renderGroup.structureDidChange = true;
      expect(h.frame()).toEqual(painterOrder(h.layer));
    }
    expect(h.mesh.quadCount).toBe(16);
  });
});
