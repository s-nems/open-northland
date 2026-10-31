import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import {
  BUILDING_LANES,
  checkLanes,
  type LaneId,
  laneCaption,
  laneName,
} from '../../../src/hud/knowledge/lanes.js';
import { messages } from '../../../src/i18n/index.js';
import { knowledgeContent } from '../../support/knowledge-content.js';

const lane = (id: LaneId) => {
  const found = BUILDING_LANES.find((l) => l.id === id);
  if (found === undefined) throw new Error(`no lane ${id}`);
  return found;
};

describe('authored lanes', () => {
  it('names a lane through the catalog', () => {
    expect(laneName(lane('iron'))).toBe(messages().knowledge.lanes.iron);
  });

  it('reports an authored parent with no edge to its child', () => {
    const problems = checkLanes(createKnowledgeBase(knowledgeContent()));
    expect(problems).toContain('flour is no input of candy');
    expect(problems).not.toContain('wheat is no input of flour');
  });

  it('reports an id the content does not hold', () => {
    const problems = checkLanes(createKnowledgeBase(knowledgeContent()));
    expect(problems).toContain('good lane names unknown good honey');
    expect(problems).toContain('building lane names unknown building barracks');
  });

  it('captions a lane with the practice its job needs, or the job alone', () => {
    const base = createKnowledgeBase(knowledgeContent());
    const { byExperience } = messages().knowledge.laneUnlock;
    expect(laneCaption(base, lane('iron'))).toBe(
      byExperience.replace('{amount}', '10').replace('{experience}', 'Wydobywanie - Żelazo'),
    );
    expect(laneCaption(base, lane('homes'))).toBeUndefined();
  });
});
