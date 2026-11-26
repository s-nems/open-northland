import glueUrl from '@browsermt/bergamot-translator/worker/bergamot-translator-worker.js?url';
import wasmUrl from '@browsermt/bergamot-translator/worker/bergamot-translator-worker.wasm?url';
import wrapperUrl from '@browsermt/bergamot-translator/worker/translator-worker.js?url';
import type { Language } from '@open-northland/data';
import { diag } from '../../diag/index.js';
import { TRANSLATE_MODELS } from './model-files.js';
import { fetchModelFile } from './model-store.js';
import { type TranslateRoute, translateRoute } from './pairs.js';

/**
 * The main-thread client of the Bergamot translation worker. It downloads (or reuses from
 * IndexedDB) the pinned Firefox Translate models a route needs, loads them into the engine, and
 * answers batch translations; the models and the work never leave the device.
 */

/** The worker message protocol the package's wrapper speaks. */
interface WorkerReply {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

/** The engine call one rpc round-trip runs. */
type Rpc = {
  readonly id: number;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

/** One batch of texts to translate, all in `from`, wanted in `to`. */
interface Job {
  readonly from: Language;
  readonly to: Language;
  readonly texts: readonly string[];
  readonly resolve: (texts: readonly string[]) => void;
  readonly reject: (error: Error) => void;
}

export interface MapTextTranslator {
  /**
   * The translations of `texts`, same order, from the map text language `from` into `to`. Throws
   * when no pinned model chain answers the pair, or a model download or engine call failed.
   */
  translate(texts: readonly string[], from: Language, to: Language): Promise<readonly string[]>;
  /** Terminates the engine and drops its memory; the model cache stays. */
  dispose(): void;
}

export function createMapTextTranslator(): MapTextTranslator {
  let worker: Worker | null = null;
  let rpcSerial = 0;
  const rpcs = new Map<number, Rpc>();
  /** The pair whose files are being gathered, so concurrent first calls share one load. */
  const loads = new Map<string, Promise<void>>();
  /** The pairs the engine holds, oldest use first. */
  const loaded = new Set<string>();
  /** The use order of the loaded pairs: the oldest gives way when a new route needs room. */
  const lru: string[] = [];
  /** How many models may sit in the engine at once. The wasm heap never shrinks, and each model's
   *  first translation costs it roughly half a gigabyte of workspace (measured against the pinned
   *  build): a fourth model aborts the engine. Two — one pivoted route — leave real headroom, and
   *  a freed model's memory is reused by the next load, so evicting keeps the heap flat. */
  const MAX_LOADED_MODELS = 2;
  /** Jobs run one at a time: the engine batches internally, and two rpcs in flight would race. */
  let queueTail: Promise<unknown> = Promise.resolve();

  /** Frees one loaded model in the engine; its memory answers the next load. */
  const freeModel = async (pair: string): Promise<void> => {
    if (!loaded.has(pair)) return;
    loaded.delete(pair);
    loads.delete(pair);
    const index = lru.indexOf(pair);
    if (index >= 0) lru.splice(index, 1);
    await rpc('freeTranslationModel', [directionOf(pair)]);
  };

  /** Marks a pair as the engine's most recently used model. */
  const touch = (pair: string): void => {
    const index = lru.indexOf(pair);
    if (index >= 0) lru.splice(index, 1);
    lru.push(pair);
  };

  /** Loads every model of `route`, from the cache where it is warm; models outside `route.pairs`
   *  give way first, so a switch of languages never piles a fourth workspace into the engine. */
  const ensureModels = (route: TranslateRoute): Promise<void> => {
    const pending = route.pairs.filter((pair) => !loaded.has(pair));
    const load = (async () => {
      while (loaded.size + pending.length > MAX_LOADED_MODELS) {
        const victim = lru.find((pair) => loaded.has(pair) && !route.pairs.includes(pair));
        if (victim === undefined) break;
        await freeModel(victim);
      }
      await Promise.all(
        pending.map(async (pair) => {
          const known = loads.get(pair);
          if (known !== undefined) return known;
          const task = (async () => {
            const model = TRANSLATE_MODELS[pair];
            if (model === undefined) throw new Error(`no pinned model for ${pair}`);
            const buffers = [await fetchModelFile(model.model), await fetchModelFile(model.shortlist)];
            const vocabs: ArrayBuffer[] = [];
            for (const vocab of model.vocabs) vocabs.push(await fetchModelFile(vocab));
            await engineReady();
            await rpc(
              'loadTranslationModel',
              [directionOf(pair), { model: buffers[0], shortlist: buffers[1], vocabs }],
              [...buffers, ...vocabs],
            );
            loaded.add(pair);
          })();
          loads.set(pair, task);
          task.catch(() => loads.delete(pair));
          return task;
        }),
      );
      for (const pair of route.pairs) touch(pair);
    })();
    return load;
  };

  /** Fails every pending rpc and forgets the engine, so the next call spawns a fresh worker and
   *  reloads its models from the device cache. Without this, one dead worker — an out-of-memory
   *  crash after many models loaded, say — would hang every later translation forever. */
  const reset = (why: string): void => {
    if (worker === null && rpcs.size === 0) return;
    diag.warn('translate', `resetting the bergamot worker: ${why}`);
    for (const rpc of rpcs.values()) rpc.reject(new Error(`bergamot worker ${why}`));
    rpcs.clear();
    worker?.terminate();
    worker = null;
    loads.clear();
    loaded.clear();
    lru.length = 0;
    ready = null;
  };

  const spawn = (): Worker => {
    if (worker !== null) return worker;
    worker = new Worker(new URL('./bergamot-worker.ts', import.meta.url));
    worker.addEventListener('message', ({ data }: MessageEvent) => {
      const reply = data as WorkerReply;
      const rpc = rpcs.get(reply.id);
      if (rpc === undefined) return;
      rpcs.delete(reply.id);
      if (reply.error !== undefined) rpc.reject(new Error(reply.error.message ?? 'bergamot worker error'));
      else rpc.resolve(reply.result);
    });
    worker.addEventListener('messageerror', () => {
      diag.warn('translate', 'a bergamot worker message failed to clone');
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      const detail = event.message || 'unknown worker error';
      const location = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : '';
      reset(`crashed: ${detail}${location}`);
    });
    return worker;
  };

  const rpc = (name: string, args: unknown[], transfer: readonly Transferable[] = []): Promise<unknown> => {
    const w = spawn();
    const id = ++rpcSerial;
    return new Promise((resolve, reject) => {
      rpcs.set(id, { id, resolve, reject });
      w.postMessage({ id, name, args }, [...transfer]);
    });
  };

  /** Initializes the engine once; the bootstrap carries the hashed asset URLs the wrapper resolves.
   *  A bootstrap that failed (a transient worker crash, say) is forgotten, so the next call retries
   *  on the fresh worker instead of caching the failure forever. */
  let ready: Promise<void> | null = null;
  const engineReady = (): Promise<void> => {
    if (ready === null) {
      ready = rpc('bootstrap', [{ glueUrl, wrapperUrl, wasmUrl }])
        .then(() => rpc('initialize', [{ cacheSize: 0 }]))
        .then(
          () => undefined,
          (error: unknown) => {
            ready = null;
            throw error;
          },
        );
    }
    return ready;
  };

  /** The engine's `{from, to}` for a registry pair id such as `en-zh_hant`. */
  const directionOf = (pair: string): { readonly from: string; readonly to: string } => ({
    from: pair.slice(0, pair.indexOf('-')),
    to: pair.slice(pair.indexOf('-') + 1),
  });

  const translate = (job: Job): void => {
    const route = translateRoute(job.from, job.to);
    if (route === null) {
      job.reject(new Error(`no translation model for ${job.from} to ${job.to}`));
      return;
    }
    queueTail = queueTail
      .then(async () => {
        await ensureModels(route);
        const result = (await rpc('translate', [
          {
            models: route.pairs.map((pair) => ({
              from: pair.slice(0, pair.indexOf('-')),
              to: pair.slice(pair.indexOf('-') + 1),
            })),
            texts: job.texts.map((text) => ({ text, html: false })),
          },
        ])) as readonly { readonly target: { readonly text: string } }[];
        return job.texts.map((_, index) => result[index]?.target.text ?? '');
      })
      .then(job.resolve, (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        diag.warn('translate', `translating ${job.texts.length} texts from ${job.from} failed: ${detail}`);
        job.reject(error instanceof Error ? error : new Error(String(error)));
      });
  };

  return {
    translate(texts, from, to) {
      if (texts.length === 0) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        translate({ from, to, texts, resolve, reject });
      });
    },
    dispose() {
      for (const rpc of rpcs.values()) rpc.reject(new Error('bergamot translator disposed'));
      rpcs.clear();
      worker?.terminate();
      worker = null;
      loads.clear();
      loaded.clear();
      lru.length = 0;
      ready = null;
    },
  };
}

/** The one translator the app's worlds share: models load once and serve every game afterwards. */
let shared: MapTextTranslator | null = null;

/** The app-wide translator, created on first use; `null` memory until a foreign text asks for it. */
export function sharedMapTextTranslator(): MapTextTranslator {
  if (shared === null) shared = createMapTextTranslator();
  return shared;
}
