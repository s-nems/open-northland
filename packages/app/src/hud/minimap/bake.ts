import {
  MINIMAP_DEPOSIT_KINDS,
  type MinimapFeature,
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
      /** Replaces the objects this and every later bake draws; absent keeps the last ones. */
      readonly objects?: MinimapObjects;
    };

export interface MinimapBakeReply {
  readonly id: number;
  readonly rgba: Uint8Array;
}

/** Rasterizes one map's scene; objects passed to a bake persist for the later ones. Their types are
 *  {@link MINIMAP_OBJECT_TYPES}. */
export interface MinimapBaker {
  bake(width: number, height: number, objects?: MinimapObjects): Promise<Uint8Array>;
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

/** A baker on the calling thread, for tests. */
export const createInlineMinimapBaker: MinimapBakerFactory = (scene) => {
  const rasterize = createMinimapRasterizer(scene);
  return {
    bake: async (width, height, objects) => rasterize(width, height, objects),
    dispose: () => {},
  };
};

/**
 * A baker on a dedicated worker: a bake at a high-DPI display's resolution costs over 100 ms, which on
 * the main thread would stall a frame at boot and on a display-resolution change.
 */
export const createWorkerMinimapBaker: MinimapBakerFactory = (scene) => {
  const worker = new Worker(new URL('./bake-worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (rgba: Uint8Array) => void; reject: (err: Error) => void }>();
  let nextId = 0;
  const failAll = (err: Error): void => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };
  worker.addEventListener('message', (event: MessageEvent<MinimapBakeReply>) => {
    const { id, rgba } = event.data;
    pending.get(id)?.resolve(rgba);
    pending.delete(id);
  });
  worker.addEventListener('error', (event) => failAll(new Error(`minimap bake worker: ${event.message}`)));
  const post = (request: MinimapBakeRequest): void => worker.postMessage(request);
  post({ kind: 'scene', scene });
  return {
    bake: (width, height, objects) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        post({ kind: 'bake', id, width, height, ...(objects !== undefined ? { objects } : {}) });
      }),
    dispose: () => {
      worker.terminate();
      failAll(new Error('minimap bake worker disposed'));
    },
  };
};
