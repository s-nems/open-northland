/** What every image smoke check shares: running docker, a free port, the wait for the health check
 *  and the verdict. */

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const HEALTH_ATTEMPTS = 60;
const HEALTH_RETRY_MS = 250;

export function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** The first successful answer from `/healthz`, once the container listens. */
export async function waitForHealth(base, image) {
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return response;
    } catch {
      // the container is not listening yet
    }
    await new Promise((resume) => setTimeout(resume, HEALTH_RETRY_MS));
  }
  throw new Error(`${image} never answered /healthz`);
}

/** Print the verdict and end the process with it. */
export function finish(image, passed) {
  console.log(passed ? `\n${image} serves the contract` : `\n${image} does not serve the contract`);
  process.exit(passed ? 0 : 1);
}
