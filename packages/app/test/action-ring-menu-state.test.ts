import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_SCOUT } from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { menuStateFor } from '../src/view/unit-controls/action-ring/menu-state.js';

/**
 * The action ring's erect-signpost button must offer exactly what `placeSignpost` accepts — both read the
 * content's scout role, so a content whose scout is not the catalog's job 27 keeps them in step. The
 * button is derived before the single-selection gate, so an empty snapshot exercises it on its own.
 */
const EMPTY: WorldSnapshot = { tick: 0, entities: [], events: [] };

describe('action-ring erect-signpost gating', () => {
  const content = sandboxContent();

  it('offers the button on a uniform scout selection and nothing else', () => {
    expect(menuStateFor(content, EMPTY, [], JOB_SCOUT).erectSignpost).toBe(true);
    expect(menuStateFor(content, EMPTY, [], JOB_COLLECTOR).erectSignpost).toBe(false);
    // A mixed selection has no uniform job — the erect order takes several scouts, so it needs one.
    expect(menuStateFor(content, EMPTY, [], undefined).erectSignpost).toBe(false);
  });
});
