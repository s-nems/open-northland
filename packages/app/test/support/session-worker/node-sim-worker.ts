import { parentPort } from 'node:worker_threads';
import { serveSession } from '../../../src/session/worker/serve.js';
import { nodeParentPort } from './node-ports.js';
import { buildTestWorld } from './test-world.js';

if (parentPort === null) throw new Error('the session worker runs inside worker_threads');
serveSession(nodeParentPort(parentPort), buildTestWorld);
