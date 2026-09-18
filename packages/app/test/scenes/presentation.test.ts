import { systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { BRIEFING_PAGE, FOLLOW_UP_PAGE, HERO_ID, presentationScene } from '../../src/scenes/presentation.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(presentationScene, import.meta.url);

/** The scene enables its script from tick 0, so the load pass runs on tick 1. */
const LOAD_PASS = 1;

/** The display results all fire on the load pass, the cutscene last, and the pass ends there: the
 *  ford mission is only visited on the next one. */
it('fires every display event on the load pass, the briefing last', () => {
  const sim = createSceneSim(presentationScene);
  sim.run(LOAD_PASS);
  // The tick also births the scene's settlers; only the script's own events are in question.
  const kinds = sim.events.current().flatMap((e) => (e.kind.startsWith('mission') ? [e.kind] : []));
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
  // The follow-up timer elapses on the second cadence pass; its page keeps the replayable one where
  // it was.
  sim.run(2 * systems.MISSION_EVALUATION_TICKS - LOAD_PASS);
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
