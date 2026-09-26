import { serveRelay } from '../../session/worker/net-serve.js';
import { endpointPort, type MessageEndpoint } from '../../session/worker/port.js';
import { buildRelayedMapWorld } from '../map/world-inputs.js';

// A dedicated worker's global scope posts and listens as its `Worker` does from the other side; the
// DOM typings the app compiles against describe a window instead.
const scope = globalThis as unknown as MessageEndpoint & { close(): void };
serveRelay(
  endpointPort(scope, () => scope.close()),
  buildRelayedMapWorld,
);
