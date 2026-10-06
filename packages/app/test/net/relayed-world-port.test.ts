import type { GameSession } from '@open-northland/lockstep';
import { encodeSnapshot } from '@open-northland/net-client';
import { exportSaveGame, Simulation } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { testContent } from '../../../sim/test/fixtures/content.js';
import { RelayedWorldPort } from '../../src/session/worker/net-world-port.js';

const SESSION: GameSession = {
  world: { kind: 'scene', sceneId: 'sandbox' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null },
  speed: 1,
};

it('refuses a snapshot still decoding when the connection ends', async () => {
  const bytes = await encodeSnapshot(exportSaveGame(new Simulation({ seed: 1, content: testContent() })));
  const post = vi.fn();
  const port = new RelayedWorldPort(post, () => {
    throw new Error('a closed connection must not build a world');
  });
  const restored = port.restore(SESSION, bytes);
  port.dispose();
  await expect(restored).resolves.toBeNull();
  await expect(port.open(SESSION, null)).resolves.toBeNull();
  expect(post).not.toHaveBeenCalled();
});
