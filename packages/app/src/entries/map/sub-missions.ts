import { localPlayerOf } from '@open-northland/lockstep';
import { exportSaveGame, type SaveGame, type SimEvent } from '@open-northland/sim';
import { loadMapScript, loadTerrainMap } from '../../content/map-loader.js';
import { loadMapList } from '../../content/maps-index.js';
import { onOffParam } from '../../game/session-rules.js';
import { mapSession } from '../../game/session-url.js';
import { sessionWorldOptions } from '../../game/session-world.js';
import { mapScriptWorld } from '../../game/world/mission-script.js';
import { relaunchSearch } from '../../view/runtime/save-load/relaunch.js';
import { buildMapWorld, type MapWorldOptions, restoreMapWorld } from './world.js';

type Transition = Extract<SimEvent, { kind: 'missionSubMission' }>['transition'];
type Inputs = Pick<MapWorldOptions, 'ir' | 'content'> & { readonly params: URLSearchParams };

export async function validateSavedMap(inputs: Inputs, save: SaveGame): Promise<void> {
  const target = save.header.mapId;
  if (target === null) throw new Error('Saved mission has no map identity');
  const [map, source] = await Promise.all([loadTerrainMap(target), loadMapScript(target)]);
  if (map === null || source === null || inputs.ir === null)
    throw new Error('Saved map content is unavailable');
  restoreMapWorld(
    { map, ir: inputs.ir, content: inputs.content, script: mapScriptWorld(source, inputs.ir) },
    save,
  );
}

export function mapSubMissionLoader(
  inputs: Inputs,
): (transition: Transition, current: SaveGame) => Promise<SaveGame> {
  return async (transition, current) => {
    const { ir, content } = inputs;
    if (ir === null) throw new Error('Sub-mission content is unavailable');
    let target: string;
    let parent: SaveGame | undefined;
    if (transition.kind === 'end') {
      parent = current.parent;
      if (parent?.header.mapId === null || parent === undefined)
        throw new Error('No parent mission to return to');
      target = parent.header.mapId;
    } else {
      const matches = (await loadMapList()).filter(
        ({ campaign }) =>
          campaign?.campaignId === transition.campaignId && campaign.missionId === transition.mapId,
      );
      if (matches.length !== 1)
        throw new Error(
          `Sub-mission ${transition.campaignId}/${transition.mapId}: expected one map, found ${matches.length}`,
        );
      const match = matches[0];
      if (match === undefined) throw new Error('Sub-mission map is unavailable');
      target = match.id;
    }
    const [map, source] = await Promise.all([loadTerrainMap(target), loadMapScript(target)]);
    if (map === null || source === null)
      throw new Error(`Sub-mission ${target}: map or script is unavailable`);
    const missionWorld = mapScriptWorld(source, ir);
    const options = {
      map,
      playerRoster: source.players,
      specialItems: source.specialItems,
      script: missionWorld,
      ir,
      content,
    };
    if (parent !== undefined) {
      if (relaunchSearch(parent.header) === null) throw new Error('Parent mission cannot be relaunched');
      restoreMapWorld(options, parent);
      return parent;
    }
    const params = new URLSearchParams(inputs.params);
    for (const key of ['scene', 'center', 'intro']) params.delete(key);
    params.set('map', target);
    const session = mapSession(params, source.players);
    const world = buildMapWorld({
      ...options,
      ...sessionWorldOptions(session, source, missionWorld),
      seed: current.header.seed,
      missions: onOffParam(params, 'missions'),
      demoOwner: localPlayerOf(session),
    });
    return exportSaveGame(world.sim, { mapId: target, entry: `?${params}`, parent: current });
  };
}
