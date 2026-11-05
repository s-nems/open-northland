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
import { markPalettedTexture } from '../../../src/gpu/pixel-art/registry.js';
import type { DrawTable } from '../../../src/gpu/still-mesh/draw-table.js';
import { QUAD_FLOATS, QuadStore, VERTICES_PER_QUAD } from '../../../src/gpu/still-mesh/quad-store.js';
import {
  INDICES_PER_QUAD,
  quietRebuildAfter,
  StillSpriteMesh,
} from '../../../src/gpu/still-mesh/still-mesh.js';
import { installWorldBatcher, worldBatched } from '../../../src/gpu/world-batch/batcher.js';
import { DepthSortedLayer } from '../../../src/gpu/world-renderer/depth-sorted-layer.js';

/**
 * The still mesh draws the still children of the depth-sorted layer in exactly the painter order Pixi's
 * own batches would, each sprite once. The harness runs Pixi's real render-group update (transforms,
 * validation, instruction builds, renderable updates) over a renderer whose GL is replaced by records:
 * a Pixi batch records the sprites it was handed, a mesh draw names its slots, a buffer upload counts.
 */

/** The texture slots a world batch binds, the renderer limit a world batcher is built for. */
const MAX_BATCH_TEXTURES = 16;
/** Pages one mesh draw lists: every batch slot but the palette LUT's. */
const DRAW_PAGES = MAX_BATCH_TEXTURES - 1;
/** Depths this far apart always file into different bands. */
const FAR = 10_000;
/** Held children changing every frame in one band. */
const SWAYING = 50;
const PAGE_SIZE = 64;
/** Frames a handed-back band is watched for further rebuilds. */
const QUIET_FRAMES = 200;
/** Renders a hot quad stays unpacked before its band's next rebuild moves it back to a cold block. */
const COOL_RENDERS = 240;
/** An interval estimate and run whose paid interval a rebuild after `BOUNDARY_ELAPSED` renders meets
 *  exactly. */
const BOUNDARY_INTERVAL = 17 / 3;
const BOUNDARY_RUN = 6;
const BOUNDARY_ELAPSED = 7;

interface Recorded {
  readonly renderPipeId: string;
  readonly sprites?: readonly Container[];
}

/** A Pixi batch as the fake batch pipe records it: the sprites, in packing order. Sprites batched with a
 *  record naming another texture than their own land in `stale`. */
function fakeRenderer(uploads: { count: number }, stale: Container[]): Renderer {
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
    buffer: {
      updateBuffer: () => {
        uploads.count++;
      },
    },
    renderPipes: {
      batch: {
        buildStart: () => {
          pending = [];
        },
        addToBatch: (element: BatchableElement & { renderable: Container }) => {
          element._batcher = fakeBatcher as never;
          const renderable = element.renderable;
          if (renderable instanceof Sprite && element.texture !== renderable.texture) stale.push(renderable);
          pending.push(renderable);
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
  /** The texture tables of the last frame's mesh draws, in painter order. */
  drawTables(): DrawTable[];
  /** The LUT each of the last frame's mesh draws binds past its pages, as its batcher names it. */
  drawLuts(): (TextureSource | null)[];
  /** The buffer uploads of the last frame. */
  uploads(): number;
  /** Sprites Pixi batched from an out-of-date record so far. */
  readonly stale: readonly Container[];
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) if (!h.layer.destroyed) h.layer.destroy({ children: true });
});

interface MeshInternals {
  readonly bands: Map<
    Container,
    {
      build: number;
      members: {
        quads: { slot: number; sprite: Sprite; live: boolean; table: DrawTable | null; textureId: number }[];
      }[];
    }
  >;
  readonly store: QuadStore | null;
}

/** A harness meshing every run whatever it saves, or at the given payoff. */
function harness(runPayoff = 0): Harness {
  const uploads = { count: 0 };
  const stale: Container[] = [];
  const renderer = fakeRenderer(uploads, stale);
  const system = new RenderGroupSystem(renderer) as unknown as {
    _updateRenderGroups(group: Container['renderGroup']): void;
  };
  const layer = new DepthSortedLayer();
  layer.isRenderGroup = true;
  const held = new Set<Container>();
  const mesh = new StillSpriteMesh((child) => held.has(child), runPayoff);
  layer.stills = mesh;
  let draws = 0;
  let tables: DrawTable[] = [];
  let luts: (TextureSource | null)[] = [];
  const h: Harness = {
    layer,
    mesh,
    held,
    meshDraws: () => draws,
    drawTables: () => tables,
    drawLuts: () => luts,
    uploads: () => uploads.count,
    stale,
    frame() {
      uploads.count = 0;
      system._updateRenderGroups(layer.renderGroup);
      const bySlot = new Map<number, Sprite>();
      for (const state of (mesh as unknown as MeshInternals).bands.values())
        for (const member of state.members)
          for (const quad of member.quads) bySlot.set(quad.slot, quad.sprite);
      const drawn: Container[] = [];
      draws = 0;
      tables = [];
      luts = [];
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
            textures?: DrawTable;
            batcher?: {
              indices: Uint32Array;
              geometry: unknown;
              lutBinding(batch: unknown): { lut: TextureSource } | null;
            };
          };
          if (instruction.renderPipeId === 'pixiBatch') drawn.push(...(instruction.sprites ?? []));
          else if (instruction.batcher !== undefined && instruction.start !== undefined) {
            draws++;
            if (instruction.textures !== undefined) tables.push(instruction.textures);
            luts.push(instruction.batcher.lutBinding(instruction)?.lut ?? null);
            // The batch pipe reads the geometry as it binds a draw.
            void instruction.batcher.geometry;
            const indices = instruction.batcher.indices;
            const end = instruction.start + (instruction.size ?? 0);
            for (let q = instruction.start; q < end; q += INDICES_PER_QUAD) {
              const sprite = bySlot.get((indices[q] ?? 0) / VERTICES_PER_QUAD);
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

/** Two palette LUTs a paletted frame can read. */
const palettes = [new TextureSource({ width: 256, height: 2 }), new TextureSource({ width: 256, height: 2 })];
/** A frame of `page` drawn through palette LUT `lut`, as a character's frames are. */
function palettedOn(page: number, lut: number): Texture {
  const texture = textureOn(page);
  const source = palettes[lut];
  if (source === undefined) throw new Error(`no palette ${lut}`);
  markPalettedTexture(texture, source);
  return texture;
}

/** The meshed quad of `sprite`. */
function quadOf(h: Harness, sprite: Sprite): { slot: number; table: DrawTable | null; textureId: number } {
  const internals = h.mesh as unknown as MeshInternals;
  const quad = [...internals.bands.values()]
    .flatMap((state) => state.members)
    .flatMap((member) => member.quads)
    .find((q) => q.sprite === sprite && q.live);
  if (quad === undefined) throw new Error('expected a meshed sprite');
  return quad;
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
  return [...internals.store.f32.slice(start, start + QUAD_FLOATS)];
}

/** The floats a world batch packs for `sprite` now, at the texture slot its record names. */
function freshPack(h: Harness, sprite: Sprite): number[] {
  const renderer = (h.mesh as unknown as { renderer: Renderer }).renderer;
  const pipe = renderer.renderPipes.sprite as unknown as { _getGpuSprite(s: Sprite): BatchableElement };
  const element = pipe._getGpuSprite(sprite);
  const out = new Float32Array(QUAD_FLOATS);
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

  it('draws a band whose pages outgrow one draw from several, each sprite on its own page', () => {
    const h = harness();
    const tree = entity(h.layer, 0, 0);
    h.held.add(tree);
    // Fill the first draw's table with pages of other stills, one of them sharing the tree's body page.
    for (let p = 1; p < DRAW_PAGES - 1; p += 2) h.held.add(entity(h.layer, 1 + p / 100, p));
    h.frame();
    expect(h.meshDraws()).toBe(1);
    expect(h.drawTables()[0]?.count).toBe(DRAW_PAGES);
    const body = tree.children[1] as Sprite;
    body.texture = textureOn(MAX_BATCH_TEXTURES + 2);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.meshDraws()).toBe(2);
    expect(h.mesh.quadCount).toBe(DRAW_PAGES + 1);
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
    // Every quad samples its own page through its draw's table.
    for (const sprite of painterOrder(h.layer) as Sprite[]) {
      const quad = quadOf(h, sprite);
      expect(quad.table?.textures[quad.textureId]).toBe(sprite.texture.source);
    }
    expect(h.stale).toEqual([]);
  });

  it('hands Pixi a child no draw can take with the frames it now shows', () => {
    const h = harness();
    const human = entity(h.layer, 0);
    h.held.add(human);
    entity(h.layer, 1);
    h.frame();
    // Two palettes in one child: no draw's table holds both, so it goes to Pixi as its band rebuilds.
    const [shadow, body] = human.children as [Sprite, Sprite];
    shadow.texture = palettedOn(2, 0);
    body.texture = palettedOn(3, 1);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(0);
    // Pixi batches both sprites with their new frames, not the ones their meshed records last drew.
    expect(h.stale).toEqual([]);
  });

  it('keeps Pixi updates reaching the quads a hidden layer re-matched', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    const crown = worldBatched(new Sprite(textureOn(2)));
    tree.addChild(crown);
    h.held.add(tree);
    h.frame();
    // Hiding the first layer re-matches the two behind it to fresh quads.
    (tree.children[0] as Sprite).visible = false;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    const band = tree.parent;
    const state = band === null ? undefined : (h.mesh as unknown as MeshInternals).bands.get(band);
    if (state === undefined) throw new Error('expected the band’s mesh state');
    const builds = state.build;
    // Another frame of the same page: Pixi's update path repacks the quad in place.
    crown.texture = textureOn(2);
    crown.tint = 0x808080;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(state.build).toBe(builds);
    expect(packedOf(h, crown)).toEqual(freshPack(h, crown));
  });

  it('keeps a quad’s texture slot when a rebuild lists new pages ahead of it', () => {
    const h = harness();
    const later = entity(h.layer, 5, 2);
    h.held.add(later);
    h.frame();
    const body = later.children[1] as Sprite;
    const before = quadOf(h, body).textureId;
    // A still in front brings pages of its own.
    h.held.add(entity(h.layer, 1, 6));
    expect(h.frame()).toEqual(painterOrder(h.layer));
    const quad = quadOf(h, body);
    expect(quad.textureId).toBe(before);
    expect(quad.table?.textures[quad.textureId]).toBe(body.texture.source);
  });

  it('points a quad at its page’s slot in the draw a rebuild moves it to', () => {
    const h = harness();
    const fillers = [];
    h.held.add(entity(h.layer, 0, 0));
    for (let p = 1; p < DRAW_PAGES - 1; p += 2) fillers.push(entity(h.layer, 1 + p / 100, p));
    for (const filler of fillers) h.held.add(filler);
    const late = entity(h.layer, 30, DRAW_PAGES + 1);
    h.held.add(late);
    h.frame();
    expect(h.meshDraws()).toBe(2);
    // One filler leaves: the late one fits the first draw's table, in the slots the filler freed.
    const gone = fillers.at(-1);
    if (gone === undefined) throw new Error('expected a filler');
    h.layer.removeChild(gone);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.meshDraws()).toBe(1);
    const body = late.children[1] as Sprite;
    const quad = quadOf(h, body);
    expect(quad.table?.textures[quad.textureId]).toBe(body.texture.source);
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
  });

  it('draws paletted quads through their draw’s LUT, one LUT a draw', () => {
    const h = harness();
    const [first, middle, last] = [0, 1, 2].map((i) => entity(h.layer, i)) as [
      Container,
      Container,
      Container,
    ];
    const humans = [first, middle, last];
    for (const human of humans) {
      for (const sprite of human.children as Sprite[]) sprite.texture = palettedOn(0, 0);
      h.held.add(human);
    }
    h.frame();
    expect(h.mesh.quadCount).toBe(6);
    expect(h.meshDraws()).toBe(1);
    expect(h.drawLuts()).toEqual([palettes[0]]);
    // The middle one now reads another palette: three draws, each binding its own LUT.
    for (const sprite of middle.children as Sprite[]) sprite.texture = palettedOn(0, 1);
    entity(h.layer, 10);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(6);
    expect(h.drawLuts()).toEqual([palettes[0], palettes[1], palettes[0]]);
    // A plain still's draw binds no LUT.
    for (const human of humans) h.held.delete(human);
    h.held.add(entity(h.layer, 20));
    h.frame();
    expect(h.drawLuts()).toEqual([null]);
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
    // The worked item, drawn by Pixi since its band rebuilt, moves between two stills.
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
    expect(h.stale).toEqual([]);
  });

  it('moves a quad repacked every few renders to a hot block, and back once it rests', () => {
    const h = harness();
    const tree = entity(h.layer, 0);
    h.held.add(tree);
    h.frame();
    const body = tree.children[1] as Sprite;
    const band = tree.parent;
    const store = (h.mesh as unknown as MeshInternals).store;
    if (band === null || store === null) throw new Error('expected a meshed band');
    expect(store.isHot(quadOf(h, body).slot)).toBe(false);
    // Repacked in place a render after its first pack: the next rebuild carries it to a hot block.
    body.position.set(3, 1);
    h.frame();
    band.renderGroup.structureDidChange = true;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(store.isHot(quadOf(h, body).slot)).toBe(true);
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
    // Left unpacked past the cool-down, the next rebuild carries it back.
    for (let i = 0; i <= COOL_RENDERS; i++) h.frame();
    band.renderGroup.structureDidChange = true;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(store.isHot(quadOf(h, body).slot)).toBe(false);
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
  });

  it('uploads the quads Pixi repacks once per frame, however many changed', () => {
    const h = harness();
    const trees = Array.from({ length: SWAYING }, (_, i) => entity(h.layer, i / 2));
    for (const tree of trees) h.held.add(tree);
    h.frame();
    for (let frame = 1; frame <= 3; frame++) {
      for (const tree of trees) (tree.children[1] as Sprite).skew.x = frame / 100;
      expect(h.frame()).toEqual(painterOrder(h.layer));
      expect(h.uploads()).toBe(1);
    }
    expect(h.mesh.quadCount).toBe(2 * SWAYING);
    const body = trees[SWAYING - 1]?.children[1] as Sprite;
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
  });

  it('hands a changing child that is no longer held to Pixi', () => {
    const h = harness();
    const walked = entity(h.layer, 0);
    const swayed = entity(h.layer, 2);
    for (const item of [walked, swayed, entity(h.layer, 5)]) h.held.add(item);
    h.frame();
    h.held.delete(walked);
    // A new frame reaches the mesh after the band chose not to rebuild: it draws current, then leaves.
    const body = walked.children[1] as Sprite;
    body.texture = textureOn(1);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(packedOf(h, body)).toEqual(freshPack(h, body));
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(4);
    // A transform reaches it before that choice: the band rebuilds in the same frame.
    h.held.delete(swayed);
    (swayed.children[1] as Sprite).skew.x = 0.01;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(2);
    (swayed.children[1] as Sprite).skew.x = 0.02;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.uploads()).toBe(0);
  });

  it('leaves a child with a non-sprite layer to Pixi', () => {
    const h = harness();
    const marked = entity(h.layer, 0);
    marked.addChild(new Graphics().rect(0, 0, 4, 4).fill(0xffffff));
    h.held.add(marked);
    h.frame();
    expect(h.mesh.quadCount).toBe(0);
  });

  it('draws the sprites of a plain container nested in a child, and repacks them when it fades', () => {
    const h = harness();
    const selected = entity(h.layer, 0);
    const outline = new Container();
    const stamps = [textureOn(4), textureOn(5)].map((t) => worldBatched(new Sprite(t)));
    outline.addChild(...stamps);
    selected.addChildAt(outline, 0);
    h.held.add(selected);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(4);
    const stamp = stamps[0] as Sprite;
    outline.alpha = 0;
    // A rebuild in the same frame takes the fade from the nested container's tick.
    entity(h.layer, 1);
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(packedOf(h, stamp)).toEqual(freshPack(h, stamp));
    outline.addChild(worldBatched(new Sprite(textureOn(6))));
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(h.mesh.quadCount).toBe(5);
  });

  it('repacks a nested container’s sprites in place when its member moves or it fades', () => {
    const h = harness();
    const selected = entity(h.layer, 0);
    const outline = new Container();
    const stamp = worldBatched(new Sprite(textureOn(4)));
    outline.addChild(stamp);
    selected.addChildAt(outline, 0);
    h.held.add(selected);
    h.frame();
    h.frame();
    const band = selected.parent;
    const state = band === null ? undefined : (h.mesh as unknown as MeshInternals).bands.get(band);
    if (state === undefined) throw new Error('expected the band’s mesh state');
    const builds = state.build;
    selected.position.x += 1;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    outline.alpha = 0.5;
    expect(h.frame()).toEqual(painterOrder(h.layer));
    expect(state.build).toBe(builds);
    expect(packedOf(h, stamp)).toEqual(freshPack(h, stamp));
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

  it('hands a band that stopped rebuilding back to Pixi once its runs no longer pay', () => {
    const h = harness(1);
    const big = Array.from({ length: 8 }, (_, i) => entity(h.layer, i));
    for (const item of big) h.held.add(item);
    entity(h.layer, 10);
    const band = big[0]?.parent;
    if (band === null || band === undefined) throw new Error('expected a band');
    for (let i = 0; i < 12; i++) {
      band.renderGroup.structureDidChange = true;
      h.frame();
    }
    expect(h.meshDraws()).toBe(1);
    const state = (h.mesh as unknown as MeshInternals).bands.get(band);
    if (state === undefined) throw new Error('expected the band’s mesh state');
    const meshedBuilds = state.build;
    // Quiet from here: the 16-quad run pays only while the band rebuilds at least every 16 frames,
    // so within that estimate's reach the band rebuilds once more and draws through Pixi alone. The
    // run divides by its payoff, so that one rebuild must land past the estimate it still pays at.
    let frames = 0;
    while (h.meshDraws() > 0 && frames < 100) {
      expect(h.frame()).toEqual(painterOrder(h.layer));
      frames++;
    }
    expect(h.meshDraws()).toBe(0);
    expect(frames).toBeGreaterThan(16);
    expect(h.mesh.quadCount).toBe(0);
    expect(state.build).toBe(meshedBuilds + 1);
    // Handed back, the band stays quiet: no further rebuild and no mesh draw.
    const builds = state.build;
    for (let i = 0; i < QUIET_FRAMES; i++) {
      expect(h.frame()).toEqual(painterOrder(h.layer));
      expect(h.meshDraws()).toBe(0);
    }
    expect(state.build).toBe(builds);
  });

  it('schedules the quiet rebuild on the rebuild’s own test, not the rounded closed form', () => {
    // A 6-quad run at payoff 1 pays while the estimate stays at most 6. From 17/3, a rebuild 7 renders
    // on lands on 6 exactly, so the run still pays; the closed form rounds to 6.999… and says 7.
    expect(quietRebuildAfter(BOUNDARY_INTERVAL, BOUNDARY_RUN, 1)).toBe(BOUNDARY_ELAPSED + 1);
  });
});
