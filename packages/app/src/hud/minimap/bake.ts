import {
  applyMinimapGroundMode,
  MINIMAP_DEPOSIT_KINDS,
  type MinimapFeature,
  type MinimapGroundMode,
  type MinimapObjectLanes,
  type MinimapObjects,
  minimapObjectLanes,
  rasterizeMinimap,
  type SceneTerrain,
  waterCellFractions,
} from '@open-northland/render/data';

/** The object types a baker's placements name, each a minimap feature by its own name. */
export const MINIMAP_OBJECT_TYPES: readonly MinimapFeature[] = ['forest', ...MINIMAP_DEPOSIT_KINDS];
const FEATURE_BY_TYPE: ReadonlyMap<string, MinimapFeature> = new Map(MINIMAP_OBJECT_TYPES.map((f) => [f, f]));

/**
 * The minimap scene as plain lanes a worker can take: each cell's ground colour is resolved up front,
 * since the scene's colour callback cannot cross threads.
 */
export interface MinimapBakeScene {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
  /** `0xRRGGBB` per cell, row-major. */
  readonly colours: Uint32Array;
  readonly elevation?: readonly number[];
  readonly brightness?: readonly number[];
  readonly water?: Float32Array;
  readonly deepWater?: Float32Array;
}

export type MinimapBakeRequest =
  | { readonly kind: 'scene'; readonly scene: MinimapBakeScene }
  | {
      readonly kind: 'bake';
      readonly id: number;
      readonly width: number;
      readonly height: number;
      readonly mode: MinimapGroundMode;
      /** Replaces the objects this and every later bake draws; absent keeps the last ones. */
      readonly objects?: MinimapObjects;
    };

export interface MinimapBakeReply {
  readonly id: number;
  readonly rgba: Uint8Array;
}

/** Rasterizes one map's scene in a ground mode; objects passed to a bake persist for the later ones.
 *  Their types are {@link MINIMAP_OBJECT_TYPES}. */
export interface MinimapBaker {
  bake(width: number, height: number, mode: MinimapGroundMode, objects?: MinimapObjects): Promise<Uint8Array>;
  dispose(): void;
}

export type MinimapBakerFactory = (scene: MinimapBakeScene) => MinimapBaker;

/** Pack a terrain's minimap scene, without object lanes, for a baker. */
export function minimapBakeScene(
  terrain: SceneTerrain,
  colourOfCell: (cell: number, typeId: number) => number,
): MinimapBakeScene {
  const water = waterCellFractions(terrain.ground, terrain.width, terrain.height);
  const colours = new Uint32Array(terrain.width * terrain.height);
  for (let cell = 0; cell < colours.length; cell++) {
    colours[cell] = colourOfCell(cell, terrain.typeIds[cell] ?? 0);
  }
  return {
    width: terrain.width,
    height: terrain.height,
    typeIds: terrain.typeIds,
    colours,
    ...(terrain.elevation !== undefined ? { elevation: terrain.elevation } : {}),
    ...(terrain.brightness !== undefined ? { brightness: terrain.brightness } : {}),
    ...(water !== undefined ? { water: water.water, deepWater: water.deep } : {}),
  };
}

/** The raster of a packed scene with the objects last given, binning them into lanes on arrival. */
export function createMinimapRasterizer(
  scene: MinimapBakeScene,
): (width: number, height: number, objects?: MinimapObjects) => Uint8Array {
  const { colours } = scene;
  const colourOfCell = (cell: number): number => colours[cell] ?? 0;
  let lanes: MinimapObjectLanes | undefined;
  return (width, height, objects) => {
    if (objects !== undefined) {
      lanes = minimapObjectLanes(scene.width, scene.height, objects, (type) => FEATURE_BY_TYPE.get(type));
    }
    return rasterizeMinimap({ ...scene, colourOfCell, ...lanes }, width, height);
  };
}

export type MinimapRasterizer = ReturnType<typeof createMinimapRasterizer>;
export type MinimapGroundBake = (
  width: number,
  height: number,
  mode: MinimapGroundMode,
  objects?: MinimapObjects,
) => Uint8Array;

/**
 * The ground in a mode, each call a fresh buffer the caller may transfer. The natural raster of the
 * last size and objects is kept, so a bake that changes only the mode grades it again instead of
 * rasterizing: on a 1880x834 raster a grade costs 8 to 9 ms of CPU (Node, M2 Pro), the full bake
 * about 445 ms. The hidden mode draws no ground, so it skips the raster and keeps any objects it was
 * handed for the next mode that needs them.
 */
export function createCachedMinimapBake(rasterize: MinimapRasterizer): MinimapGroundBake {
  let natural: { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | null = null;
  let heldObjects: MinimapObjects | undefined;
  return (width, height, mode, objects) => {
    if (mode === 'hidden') {
      if (objects !== undefined) {
        heldObjects = objects;
        natural = null;
      }
      return applyMinimapGroundMode(opaqueRaster(width, height), mode);
    }
    const nextObjects = objects ?? heldObjects;
    heldObjects = undefined;
    if (
      nextObjects !== undefined ||
      natural === null ||
      natural.width !== width ||
      natural.height !== height
    ) {
      natural = { width, height, rgba: rasterize(width, height, nextObjects) };
    }
    return applyMinimapGroundMode(natural.rgba, mode, new Uint8Array(natural.rgba.length));
  };
}

const RGBA = 4;
const OPAQUE = 0xff;

function opaqueRaster(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * RGBA);
  for (let i = RGBA - 1; i < rgba.length; i += RGBA) rgba[i] = OPAQUE;
  return rgba;
}

/** A baker on the calling thread, for tests. */
export const createInlineMinimapBaker: MinimapBakerFactory = (scene) => {
  const bake = createCachedMinimapBake(createMinimapRasterizer(scene));
  return {
    bake: async (width, height, mode, objects) => bake(width, height, mode, objects),
    dispose: () => {},
  };
};

/** The part of a `Worker` the bake client uses, so a test can stand in for the thread. */
export interface MinimapBakeWorker {
  addEventListener(type: 'message', listener: (event: MessageEvent<MinimapBakeReply>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  postMessage(request: MinimapBakeRequest): void;
  terminate(): void;
}

const spawnBakeWorker = (): MinimapBakeWorker =>
  new Worker(new URL('./bake-worker.ts', import.meta.url), { type: 'module' });

/**
 * A baker on a dedicated worker. Measured on magiczny_las at DPR 2 (Node, M2 Pro), a bake takes 37 ms
 * for the S panel (460x204), 60 to 105 ms for M to XL (760 to 940 px wide) and 445 ms for XL at 2x zoom
 * (1880x834); on the main thread that would stall frames at boot, on a resize and on a zoom. A worker error fails
 * the client for good: the pending bakes and every later one reject at once.
 */
export function createWorkerMinimapBaker(
  scene: MinimapBakeScene,
  spawn: () => MinimapBakeWorker = spawnBakeWorker,
): MinimapBaker {
  const worker = spawn();
  const pending = new Map<number, { resolve: (rgba: Uint8Array) => void; reject: (err: Error) => void }>();
  let nextId = 0;
  let failure: Error | null = null;
  const fail = (err: Error): void => {
    failure ??= err;
    worker.terminate();
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };
  worker.addEventListener('message', (event) => {
    const { id, rgba } = event.data;
    pending.get(id)?.resolve(rgba);
    pending.delete(id);
  });
  worker.addEventListener('error', (event) => fail(new Error(`minimap bake worker: ${event.message}`)));
  worker.postMessage({ kind: 'scene', scene });
  return {
    bake: (width, height, mode, objects) => {
      if (failure !== null) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({
          kind: 'bake',
          id,
          width,
          height,
          mode,
          ...(objects !== undefined ? { objects } : {}),
        });
      });
    },
    dispose: () => fail(new Error('minimap bake worker disposed')),
  };
}
