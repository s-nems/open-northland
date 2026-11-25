import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMapTextTranslator } from '../../../src/i18n/translate/service.js';

// The model cache answers from memory: no IndexedDB, no download.
vi.mock('../../../src/i18n/translate/model-store.js', () => ({
  fetchModelFile: vi.fn(async (file: { name: string }) => new TextEncoder().encode(file.name).buffer),
}));

/** The worker protocol message the service sends. */
interface RpcMessage {
  readonly id: number;
  readonly name: string;
  readonly args: unknown[];
}

/**
 * A stand-in for the Bergamot worker: it records the rpcs and, while `auto` runs, answers each one
 * a microtask later — engine setup with null, a translate with one canned result. With `auto` off,
 * the rpcs stay open: the test drives the replies by hand and can crash the worker mid-flight. The
 * flag is static because the engine spawns lazily — the first rpc flies only after a few microtask
 * hops, and the tests cannot reach in before that.
 */
class FakeWorker {
  static auto = true;
  static instances: FakeWorker[] = [];
  readonly received: RpcMessage[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  postMessage(message: RpcMessage): void {
    this.received.push(message);
    if (!FakeWorker.auto) return;
    queueMicrotask(() => {
      this.emit(message.id, {
        result: message.name === 'translate' ? [{ target: { text: 'Hallo übersetzt' } }] : null,
      });
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Emits the worker's message event by hand, for tests that drive the replies. */
  emit(id: number, reply: { result?: unknown; error?: { message: string } }): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: { id, ...reply } });
  }

  /** Emits the worker's error event, as a crashed worker does. */
  crash(): void {
    for (const listener of this.listeners.get('error') ?? []) listener({});
  }
}

/** Lets the service's queued chain run to its next rpc. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const lastWorker = (): FakeWorker => {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('no fake worker spawned');
  return worker;
};

describe('createMapTextTranslator', () => {
  afterEach(() => {
    FakeWorker.auto = true;
    vi.unstubAllGlobals();
    FakeWorker.instances.length = 0;
  });

  it('boots the engine, loads the route model and translates', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const translator = createMapTextTranslator();
    const result = await translator.translate(['Hello there.'], 'eng', 'ger');
    expect(result).toEqual(['Hallo übersetzt']);

    const worker = lastWorker();
    const names = worker.received.map((message) => message.name);
    expect(names).toContain('bootstrap');
    expect(names).toContain('initialize');
    const load = worker.received.find((message) => message.name === 'loadTranslationModel');
    if (load === undefined) throw new Error('no loadTranslationModel rpc');
    expect(load.args[0]).toEqual({ from: 'en', to: 'de' });
    translator.dispose();
  });

  it('rejects pending jobs when the worker crashes, and rebuilds the engine on the next call', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.auto = false; // the rpcs stay open
    const translator = createMapTextTranslator();

    const pending = translator.translate(['Hello there.'], 'eng', 'ger');
    await settle();
    const firstWorker = lastWorker();
    expect(firstWorker.received.some((message) => message.name === 'bootstrap')).toBe(true);

    firstWorker.crash(); // the worker dies with rpcs in flight
    await expect(pending).rejects.toThrow('bergamot worker crashed');
    expect(firstWorker.terminated).toBe(true);

    FakeWorker.auto = true; // the next call spawns a fresh worker that answers
    const recovered = await translator.translate(['Hello there.'], 'eng', 'ger');
    expect(recovered).toEqual(['Hallo übersetzt']);
    expect(FakeWorker.instances.length).toBe(2);
    translator.dispose();
  });

  it('retries a failed bootstrap on the next call instead of caching the failure', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.auto = false;
    const translator = createMapTextTranslator();

    const pending = translator.translate(['Hello there.'], 'eng', 'ger');
    await settle();
    const worker = lastWorker();
    const bootstrap = worker.received.find((message) => message.name === 'bootstrap');
    if (bootstrap === undefined) throw new Error('no bootstrap rpc');
    worker.emit(bootstrap.id, { error: { message: 'bootstrap failed' } });
    await expect(pending).rejects.toThrow('bootstrap failed');

    FakeWorker.auto = true; // the retry reaches a healthy engine
    const recovered = await translator.translate(['Hello there.'], 'eng', 'ger');
    expect(recovered).toEqual(['Hallo übersetzt']);
    expect(worker.received.filter((message) => message.name === 'bootstrap').length).toBe(2);
    translator.dispose();
  });

  it('evicts the oldest model before a new route loads, so the engine holds two at most', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const translator = createMapTextTranslator();

    await translator.translate(['Hello there.'], 'eng', 'ger'); // loads en-de
    await translator.translate(['Cześć.'], 'pol', 'chs'); // route pl-en + en-zh: en-de gives way
    await translator.translate(['Hello there.'], 'eng', 'ger'); // en-de reloads, pl-en gives way

    const worker = lastWorker();
    const events = worker.received
      .filter((message) => message.name === 'loadTranslationModel' || message.name === 'freeTranslationModel')
      .map((message) => {
        const direction = message.args[0] as { from: string; to: string };
        return `${message.name === 'freeTranslationModel' ? 'free' : 'load'} ${direction.from}-${direction.to}`;
      });
    expect(events).toEqual([
      'load en-de',
      'free en-de', // the first route's model gives way before the second route's first leg
      'load pl-en',
      'load en-zh',
      'free pl-en', // and back again: the second route's first leg gives way to the reload
      'load en-de',
    ]);

    // The running balance never exceeds two loaded models: the abort threshold of the wasm heap.
    let balance = 0;
    for (const event of events) balance += event.startsWith('load') ? 1 : -1;
    expect(balance).toBeLessThanOrEqual(2);
    translator.dispose();
  });

  it('reloads a freed model when a route comes back, reading from the device cache', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const translator = createMapTextTranslator();

    await translator.translate(['Hello there.'], 'eng', 'ger'); // loads en-de
    await translator.translate(['Cześć.'], 'pol', 'chs'); // evicts en-de
    const result = await translator.translate(['Hello there.'], 'eng', 'ger'); // reloads it
    expect(result).toEqual(['Hallo übersetzt']);

    const worker = lastWorker();
    const enDeLoads = worker.received.filter(
      (message) =>
        message.name === 'loadTranslationModel' &&
        (message.args[0] as { from: string; to: string }).to === 'de',
    );
    expect(enDeLoads.length).toBe(2);
    translator.dispose();
  });
});
