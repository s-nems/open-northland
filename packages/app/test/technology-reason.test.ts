import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_COLLECTOR, JOB_FARMER } from '../src/catalog/jobs.js';
import { GOOD_WHEAT } from '../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { technologyLabel, technologyReason } from '../src/game/technology.js';
import { messages } from '../src/i18n/index.js';

const content = sandboxContent(grassTerrain(8, 8));
const open = { allowed: true, enabled: true, enablingJobs: [], requiredJobs: [], requiredGoods: [] };

describe('technologyReason', () => {
  it('names a forbidden type, nothing for an open one', () => {
    expect(technologyReason(content, { ...open, allowed: false })).toBe(messages().hud.technologyForbidden);
    expect(technologyReason(content, open)).toBeNull();
  });

  it('names the trade whose work discovers a missing good, unless that trade is missing itself', () => {
    const wheat = technologyLabel(content, 'good', GOOD_WHEAT);
    const farmer = technologyLabel(content, 'job', JOB_FARMER);
    const collector = technologyLabel(content, 'job', JOB_COLLECTOR);
    const byFarmer = technologyReason(content, {
      ...open,
      enabled: false,
      requiredGoods: [{ good: GOOD_WHEAT, jobs: [JOB_FARMER] }],
    });
    expect(byFarmer).toBe(`${messages().hud.technologyRequires} ${wheat} (${farmer})`);
    const missingTrade = technologyReason(content, {
      ...open,
      enabled: false,
      requiredJobs: [JOB_FARMER],
      requiredGoods: [{ good: GOOD_WHEAT, jobs: [JOB_FARMER] }],
    });
    expect(missingTrade).toBe(`${messages().hud.technologyRequires} ${farmer}, ${wheat}`);
    const byEnabler = technologyReason(content, { ...open, enabled: false, enablingJobs: [JOB_COLLECTOR] });
    expect(byEnabler).toBe(`${messages().hud.technologyRequires} ${collector}`);
  });
});
