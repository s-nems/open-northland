import type { MessagePort, Worker } from 'node:worker_threads';
import type { SessionPort } from '../../../src/session/worker/port.js';

/** Node hands a message over already deserialized, so no receive time is measurable here. */
const UNMEASURED_MS = 0;

/** The runtime's end over a `worker_threads` worker. */
export function nodeWorkerPort(worker: Worker): SessionPort {
  return {
    post: (message, transfer = []) => worker.postMessage(message, [...transfer]),
    listen: (receive) => {
      worker.on('message', (message: unknown) => receive(message, UNMEASURED_MS));
    },
    close: () => void worker.terminate(),
  };
}

/** The worker's end: `worker_threads`' `parentPort`. */
export function nodeParentPort(port: MessagePort): SessionPort {
  return {
    post: (message, transfer = []) => port.postMessage(message, [...transfer]),
    listen: (receive) => {
      port.on('message', (message: unknown) => receive(message, UNMEASURED_MS));
    },
    close: () => port.close(),
  };
}
