import { endpointPort, type MessageEndpoint } from '../../session/worker/port.js';
import { serveSession } from '../../session/worker/serve.js';
import { buildMapWorkerWorld } from './world-inputs.js';

// A dedicated worker's global scope posts and listens as its `Worker` does from the other side; the
// DOM typings the app compiles against describe a window instead.
const scope = globalThis as unknown as MessageEndpoint & { close(): void };
serveSession(
  endpointPort(scope, () => scope.close()),
  buildMapWorkerWorld,
);
