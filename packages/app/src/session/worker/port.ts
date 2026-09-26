/**
 * One end of the channel between the runtime and the sim's worker. A browser `Worker`, a worker's own
 * global scope and Node's `worker_threads` ports all fit behind it: each posts structured clones,
 * transfers `ArrayBuffer`s, and delivers messages in order.
 */
export interface SessionPort {
  post(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  /** `receiveMs` is the time this thread spent deserializing the message, where the port can tell. */
  listen(receive: (message: unknown, receiveMs: number) => void): void;
  /** The other side failed: it did not load, threw outside a message, or sent a message that could not
   *  be deserialized. */
  listenFailure(fail: (error: Error) => void): void;
  close(): void;
}

/** What the browser's `Worker` and a worker's global scope share. */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
}

/** A browser endpoint; `close` ends the other side (`Worker.terminate`) or this one (`self.close`). */
export function endpointPort(endpoint: MessageEndpoint, close: () => void): SessionPort {
  return {
    post: (message, transfer = []) => endpoint.postMessage(message, [...transfer]),
    listen: (receive) =>
      endpoint.addEventListener('message', (event) => {
        // Approximation: Chromium deserializes a message's data when it is first read, so the read is
        // the cost there; Firefox and WebKit deserialize before dispatch, where this reads near zero.
        const start = performance.now();
        const data: unknown = event.data;
        receive(data, performance.now() - start);
      }),
    listenFailure: (fail) => {
      endpoint.addEventListener('error', (event) => {
        // A worker script that fails to load dispatches a bare `Event`, with no message to show.
        fail(new Error(event instanceof ErrorEvent ? event.message : 'the sim worker failed to load'));
      });
      endpoint.addEventListener('messageerror', () =>
        fail(new Error('a sim worker message could not be read')),
      );
    },
    close,
  };
}
