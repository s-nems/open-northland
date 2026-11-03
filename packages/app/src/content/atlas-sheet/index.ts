import {
  type AtlasImageEncoding,
  type AtlasSheetLayout,
  RecolouredPageSource,
  type TextureSource,
} from '@open-northland/render';
import { diag } from '../../diag/log.js';
import { loadAtlasWithMods, moddedContentAssetUrl } from '../net.js';
import { atlasImagePath, contentUrl } from '../url.js';
import { colourOnPage, indexedOnPage } from './page-colour.js';
import type {
  IndexedSheetPixels,
  PalettedSheetPayload,
  PalettedSheetReply,
  PalettedSheetRequest,
} from './protocol.js';

/** The manifest fields that say which sheet a stem draws from and how it is coloured. */
export interface AtlasSheetRef {
  readonly image: string;
  /** Base64 RGB palette: `image` is an indexed sheet shared by the bob set's recolours. */
  readonly palette?: string;
  /** How a paletted `image` is stored. */
  readonly imageEncoding?: AtlasImageEncoding;
}

/** The part of a `Worker` the client uses, so a test can stand in for the thread. */
export interface PalettedSheetWorker {
  addEventListener(type: 'message', listener: (event: MessageEvent<PalettedSheetReply>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  postMessage(request: PalettedSheetRequest): void;
  terminate(): void;
}

/**
 * Workers decoding paletted sheets (and colouring a DOM picture's), far too slow for the main thread
 * at boot. A few threads keep them from queueing behind each other; each sheet's requests go to one
 * worker, whose cache then decodes the sheet once.
 */
const MAX_WORKERS = 3;

/** Cores assumed when the browser does not report `hardwareConcurrency`. */
const FALLBACK_CORES = 2;
/** Cores left to the page's main thread. */
const MAIN_THREAD_CORES = 1;

/** A worker asked for nothing this long is terminated, so a finished boot holds no threads; the next
 *  sheet spawns it again. */
export const IDLE_WORKER_TERMINATE_MS = 10_000;

/** Multiplier of the string hash that pins a sheet URL to one worker, so its stems share a decode. */
const URL_HASH_MULTIPLIER = 31;

const spawnWorker = (): PalettedSheetWorker =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

interface Pending {
  readonly resolve: (payload: PalettedSheetPayload) => void;
  readonly reject: (err: Error) => void;
}

/** One live worker and the requests it still owes. */
interface Slot {
  readonly worker: PalettedSheetWorker;
  readonly pending: Map<number, Pending>;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * A pool of colouring workers, spawned on first use: the coloured page of an indexed sheet through a
 * palette, or without one the sheet's own index and coverage bytes. A worker
 * that fails (its script did not load, a redeploy's 404, a CSP refusal) rejects what it owed and leaves
 * its slot, so the next request spawns a fresh one.
 */
export function createPalettedSheetClient(
  spawn: () => PalettedSheetWorker = spawnWorker,
  size = Math.max(
    1,
    Math.min(MAX_WORKERS, (globalThis.navigator?.hardwareConcurrency ?? FALLBACK_CORES) - MAIN_THREAD_CORES),
  ),
  idleMs = IDLE_WORKER_TERMINATE_MS,
): (url: string, palette?: string) => Promise<PalettedSheetPayload> {
  const slots: (Slot | undefined)[] = [];
  let nextId = 0;
  const retire = (index: number, slot: Slot): void => {
    clearTimeout(slot.idleTimer);
    if (slots[index] === slot) slots[index] = undefined;
    slot.worker.terminate();
  };
  const idleAfterLastReply = (index: number, slot: Slot): void => {
    if (slot.pending.size > 0) return;
    clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => {
      if (slot.pending.size === 0) retire(index, slot);
    }, idleMs);
  };
  const slotFor = (url: string): Slot => {
    let hash = 0;
    for (let i = 0; i < url.length; i++) hash = (hash * URL_HASH_MULTIPLIER + url.charCodeAt(i)) >>> 0;
    const index = hash % size;
    const live = slots[index];
    if (live !== undefined) return live;
    const slot: Slot = { worker: spawn(), pending: new Map(), idleTimer: undefined };
    slot.worker.addEventListener('message', (event) => {
      const reply = event.data;
      const waiting = slot.pending.get(reply.id);
      slot.pending.delete(reply.id);
      if ('error' in reply) waiting?.reject(new Error(reply.error));
      // A reply nobody waits for any more (its request was rejected) may still hold a bitmap to free.
      else if (waiting === undefined) {
        if ('bitmap' in reply) reply.bitmap.close();
      } else waiting.resolve(reply);
      idleAfterLastReply(index, slot);
    });
    slot.worker.addEventListener('error', (event) => {
      retire(index, slot);
      const err = new Error(`paletted sheet worker: ${event.message || 'failed'}`);
      for (const { reject } of slot.pending.values()) reject(err);
      slot.pending.clear();
    });
    slots[index] = slot;
    return slot;
  };
  return (url, palette) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const slot = slotFor(url);
      clearTimeout(slot.idleTimer);
      slot.pending.set(id, { resolve, reject });
      slot.worker.postMessage(palette === undefined ? { id, url } : { id, url, palette });
    });
}

let workers: ((url: string, palette?: string) => Promise<PalettedSheetPayload>) | undefined;

/** Whether the workers can decode a sheet: they need `DecompressionStream`, which reached pages and
 *  workers together (Safari 16.4). Without it the page reads a sheet through a canvas. */
const workersDecode = (): boolean => typeof DecompressionStream === 'function';

function sheetWorkers(): (url: string, palette?: string) => Promise<PalettedSheetPayload> {
  workers ??= createPalettedSheetClient();
  return workers;
}

async function colourInWorkers(url: string, palette: string): Promise<ImageBitmap> {
  const payload = await sheetWorkers()(url, palette);
  if (!('bitmap' in payload)) throw new Error(`paletted sheet ${url}: no coloured page in the reply`);
  return payload.bitmap;
}

async function indexedInWorkers(url: string): Promise<IndexedSheetPixels> {
  const payload = await sheetWorkers()(url);
  if (!('indexed' in payload)) throw new Error(`paletted sheet ${url}: no sheet bytes in the reply`);
  return payload.indexed;
}

/** A paletted sheet's absolute URL: a worker resolves a URL against its own script. */
const sheetUrl = (image: string): string =>
  new URL(contentUrl(atlasImagePath(image)), globalThis.location.href).href;

/** A stem whose sheet is paletted. */
export type PalettedSheetRef = AtlasSheetRef & { readonly palette: string };

/** The coloured page of a paletted stem; rejects when the sheet cannot be fetched or decoded. */
export function palettedSheetBitmap(sheet: PalettedSheetRef): Promise<ImageBitmap> {
  if (sheet.imageEncoding !== 'index-coverage-png') {
    return Promise.reject(new Error(`atlas sheet ${sheet.image}: unknown encoding ${sheet.imageEncoding}`));
  }
  return moddedContentAssetUrl(sheetUrl(sheet.image)).then((url) =>
    (workersDecode() ? colourInWorkers : colourOnPage)(url, sheet.palette),
  );
}

/** Recoloured pages by sheet image: every recolour of a bob set draws from the one page. */
const recolouredPages = new Map<string, Promise<RecolouredPageSource>>();

/**
 * The shared page a paletted stem draws from through its palette: the sheet's index and coverage
 * bytes, decoded off the main thread, never coloured. Rejects when the sheet cannot be fetched or
 * decoded; a failure is not kept, so the next stem tries again.
 */
export function recolouredPage(sheet: PalettedSheetRef): Promise<RecolouredPageSource> {
  if (sheet.imageEncoding !== 'index-coverage-png') {
    return Promise.reject(new Error(`atlas sheet ${sheet.image}: unknown encoding ${sheet.imageEncoding}`));
  }
  let page = recolouredPages.get(sheet.image);
  if (page === undefined) {
    const loadIndexed = workersDecode() ? indexedInWorkers : indexedOnPage;
    page = moddedContentAssetUrl(sheetUrl(sheet.image))
      .then((url) => loadIndexed(url))
      .then(({ pixels, width, height }) => new RecolouredPageSource(pixels, width, height));
    recolouredPages.set(sheet.image, page);
    const pending = page;
    pending.catch(() => {
      if (recolouredPages.get(sheet.image) === pending) recolouredPages.delete(sheet.image);
    });
  }
  return page;
}

/** Sheets whose failed colouring was reported, one warning each. */
const warnedColouring = new Set<string>();
/** Paletted sheets a DOM picture asked for, one warning each. */
const warnedPictures = new Set<string>();

/**
 * A stem's atlas page for the renderer: its own sheet, or a paletted stem's shared {@link recolouredPage}.
 * A paletted sheet that fails resolves `undefined`, warned once per sheet, like a missing optional
 * texture.
 */
export async function loadAtlasSheet(
  sheet: AtlasSheetRef,
  layout: AtlasSheetLayout,
): Promise<TextureSource | undefined> {
  if (sheet.palette === undefined) {
    return loadAtlasWithMods(contentUrl(atlasImagePath(sheet.image)), 'nearest', layout);
  }
  try {
    return await recolouredPage({ ...sheet, palette: sheet.palette });
  } catch (err) {
    if (!warnedColouring.has(sheet.image)) {
      warnedColouring.add(sheet.image);
      diag.warn('content', `atlas sheet ${sheet.image} could not be read; its stems draw nothing`, err);
    }
    return undefined;
  }
}

/**
 * The URL a DOM picture (an `<img>`, a CSS background) shows a stem's sheet from, or null for a
 * paletted sheet, whose pixels are palette indices: the pipeline serves the sheets the DOM reads in
 * colour.
 */
export function pictureSheetUrl(sheet: AtlasSheetRef): string | null {
  if (sheet.palette !== undefined) {
    if (!warnedPictures.has(sheet.image)) {
      warnedPictures.add(sheet.image);
      diag.warn('content', `atlas sheet ${sheet.image} is paletted, so no picture shows it`);
    }
    return null;
  }
  return contentUrl(atlasImagePath(sheet.image));
}
