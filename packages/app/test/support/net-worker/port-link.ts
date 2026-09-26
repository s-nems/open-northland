import type { MessagePort } from 'node:worker_threads';
import type { ClientMessage } from '@open-northland/net-protocol';
import type { RelayLinkFactory } from '../../../src/session/worker/net-serve.js';

/**
 * The network worker's relay link carried over a `MessagePort` instead of a WebSocket: the test thread
 * holds the other end and plugs it into the virtual network, so the raw relay messages cross as they
 * would the socket.
 */

/** The test thread to the worker's link. */
export type ToWorkerLink =
  /** The socket opened: the worker's client says hello. */
  | { readonly kind: 'open' }
  /** A relay message, as the socket would have received it. */
  | { readonly kind: 'message'; readonly raw: unknown };

/** The worker's link to the test thread. */
export type FromWorkerLink =
  | { readonly kind: 'send'; readonly message: ClientMessage }
  /** The worker's client closed its link. */
  | { readonly kind: 'closed' };

/** The worker's side: a link that is down until the test thread opens it. */
export function portLinkFactory(port: MessagePort): RelayLinkFactory {
  return (_url, events) => {
    let connected = false;
    const post = (message: FromWorkerLink): void => port.postMessage(message);
    port.on('message', (message: ToWorkerLink) => {
      if (message.kind === 'open') {
        connected = true;
        events.onOpen();
      } else if (connected) events.onMessage(message.raw);
    });
    return {
      get connected() {
        return connected;
      },
      send: (message) => {
        if (connected) post({ kind: 'send', message });
        return connected;
      },
      close: () => {
        connected = false;
        post({ kind: 'closed' });
        port.close();
      },
    };
  };
}
