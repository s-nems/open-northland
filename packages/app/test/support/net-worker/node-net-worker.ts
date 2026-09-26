import { type MessagePort, parentPort, workerData } from 'node:worker_threads';
import { buildRelayedMapWorld } from '../../../src/entries/map/world-inputs.js';
import { serveRelay } from '../../../src/session/worker/net-serve.js';
import { nodeParentPort } from '../session-worker/node-ports.js';
import { portLinkFactory } from './port-link.js';

/** The network worker the relay entry runs, its socket replaced by the port in `workerData.link`. */
export interface NetWorkerData {
  readonly link: MessagePort;
}

if (parentPort === null) throw new Error('the network worker runs inside worker_threads');
const { link } = workerData as NetWorkerData;
serveRelay(nodeParentPort(parentPort), buildRelayedMapWorld, portLinkFactory(link));
