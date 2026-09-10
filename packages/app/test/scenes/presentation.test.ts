import { systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { BRIEFING_PAGE, FOLLOW_UP_PAGE, HERO_ID, presentationScene } from '../../src/scenes/presentation.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(presentationScene, import.meta.url);

const FIRST_PASS = systems.MISSION_EVALUATION_TICKS;

/** The display results all fire on the first pass, the cutscene last, and the pass ends there: the
 *  ford mission is only visited on the next one. */
it('fires every display event on the first pass, the briefing last', () => {
  const sim = createSceneSim(presentationScene);
  sim.run(FIRST_PASS);
  const kinds = sim.events.current().map((e) => e.kind);
  expect(kinds).toEqual([
    'missionGuiMarker',
    'missionCamera',
    'missionSound',
    'missionWeather',
    'missionEarthquake',
    'missionSelectHuman',
    'missionCutscene',
  ]);
  const cutscene = sim.events.current().find((e) => e.kind === 'missionCutscene');
  expect(cutscene).toEqual({ kind: 'missionCutscene', mission: 0, page: BRIEFING_PAGE, replay: true });
  const selected = sim.events.current().find((e) => e.kind === 'missionSelectHuman');
  if (selected?.kind !== 'missionSelectHuman') throw new Error('no selection');
  expect(selected.select).toBe(true);
  // The one selected is the hero, the only settler carrying the script's id.
  const [hero] = systems.missionObjects(sim.world, HERO_ID);
  expect(hero).toBe(selected.entity);
  // The second pass brings the follow-up page, which keeps the replayable one where it was.
  sim.run(FIRST_PASS);
  const later = sim.events.current();
  expect(later.map((e) => e.kind)).toEqual(['missionAreaMarkers', 'missionCutscene']);
  expect(later.find((e) => e.kind === 'missionCutscene')).toEqual({
    kind: 'missionCutscene',
    mission: 2,
    page: FOLLOW_UP_PAGE,
    replay: false,
  });
  expect(sim.missionBriefingPage()).toBe(BRIEFING_PAGE);
});
