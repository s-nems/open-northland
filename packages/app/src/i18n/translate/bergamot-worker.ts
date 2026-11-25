/**
 * The translation worker: a classic worker that loads the `@browsermt/bergamot-translator` WASM
 * engine (the Bergamot build Firefox Translate runs) and speaks its `{id, name, args}` message
 * protocol to the main thread, unmodified.
 *
 * The package's own wrapper resolves its two engine files relative to its script URL. Here they are
 * hashed Vite assets, so the wrapper's `importScripts('bergamot-translator-worker.js')` and its wasm
 * fetch go through shims that redirect to the URLs the bootstrap message carried.
 */

/** The slice of the worker global scope this file touches; the package's wrapper uses the rest. */
interface WorkerScope {
  importScripts(...urls: readonly (string | URL)[]): void;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

/** The engine files the main thread resolves at build time. */
interface EngineUrls {
  /** The package's emscripten glue, which instantiates the wasm. */
  readonly glueUrl: string;
  /** The package's protocol wrapper, which defines the worker methods and its listener. */
  readonly wrapperUrl: string;
  /** The `bergamot-translator-worker.wasm` binary. */
  readonly wasmUrl: string;
}

const scope = self as unknown as WorkerScope;
let engine: EngineUrls | null = null;

/** Takes the bootstrap before the wrapper's own listener can reject the unknown method name. */
scope.addEventListener('message', (event) => {
  const data = event.data as { readonly id?: number; readonly name?: string; readonly args?: unknown[] };
  if (data?.name !== 'bootstrap') return;
  event.stopImmediatePropagation();
  engine = data.args?.[0] as EngineUrls;
  scope.importScripts(engine.wrapperUrl);
  // The wrapper never saw this message, so the client's round-trip is answered here.
  scope.postMessage({ id: data.id, result: null });
});

const realImportScripts = scope.importScripts.bind(scope);
scope.importScripts = (...urls: readonly (string | URL)[]): void => {
  realImportScripts(
    ...urls.map((url) => {
      const name = String(url).split('/').pop();
      return name === 'bergamot-translator-worker.js' && engine !== null ? engine.glueUrl : url;
    }),
  );
};

const realFetch = scope.fetch.bind(scope);
scope.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  const wanted = engine !== null && url.endsWith('/bergamot-translator-worker.wasm') ? engine.wasmUrl : input;
  return realFetch(wanted as RequestInfo, init);
};
