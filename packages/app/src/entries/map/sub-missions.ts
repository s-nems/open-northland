import { mapLobbySlots } from '@open-northland/data';
import { localPlayerOf } from '@open-northland/lockstep';
import { exportSaveGame, type SaveGame, type SimEvent } from '@open-northland/sim';
import { campaignForMap, loadCampaigns } from '../../campaign/catalog.js';
import { loadMapScript, loadTerrainMap } from '../../content/map-loader.js';
import { loadMapSources, type MapSource, mapFetch } from '../../content/map-source/index.js';
import { sessionMapScript } from '../../game/seat-tribes.js';
import { onOffParam } from '../../game/session-rules.js';
import { mapSession } from '../../game/session-url.js';
import { sessionWorldOptions } from '../../game/session-world.js';
import { mapScriptWorld } from '../../game/world/mission-script.js';
import { relaunchSearch } from '../../view/runtime/save-load/relaunch.js';
import { SCENE_TOKEN_PREFIX } from '../../view/runtime/save-load/world-names.js';
import { buildMapWorld, type MapWorldOptions, restoreMapWorld } from './world.js';

type Transition = Extract<SimEvent, { kind: 'missionSubMission' }>['transition'];
type Inputs = Pick<MapWorldOptions, 'ir' | 'content'> & { readonly params: URLSearchParams };

/**
 * The maps a sub-mission of `currentMapId` may start: the other maps of its catalogue entry when it is
 * an installed catalogue map, the shipped maps otherwise, so two packs' campaign ids never collide.
 */
export function subMissionPool(
  sources: readonly MapSource[],
  currentMapId: string | null,
  campaignMapIds?: ReadonlySet<string>,
): readonly MapSource[] {
  if (campaignMapIds !== undefined)
    return sources.filter((source) => campaignMapIds.has(source.entry.id) && !source.stale);
  const key = currentMapId?.toLowerCase();
  const current = sources.find((source) => source.entry.id.toLowerCase() === key);
  const entryId = (current?.catalog ?? current?.local)?.entryId;
  return entryId === undefined
    ? sources.filter((source) => source.catalog === undefined && source.local === undefined)
    : sources.filter((source) => (source.catalog ?? source.local)?.entryId === entryId && !source.stale);
}

/** Restore a map save off to the side, so a broken one is refused before the running world goes.
 *  A scene save builds its world from code, with no map content to check. */
export async function validateSavedMap(inputs: Inputs, save: SaveGame): Promise<void> {
  const target = save.header.mapId;
  if (target === null) throw new Error('Saved mission has no map identity');
  if (target.startsWith(SCENE_TOKEN_PREFIX)) return;
  const files = await mapFetch(target);
  const [map, source] = await Promise.all([loadTerrainMap(target, files), loadMapScript(target, files)]);
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
      const campaign =
        current.header.mapId === null
          ? undefined
          : campaignForMap(await loadCampaigns(), current.header.mapId);
      const matches = subMissionPool(
        await loadMapSources(),
        current.header.mapId,
        campaign === undefined ? undefined : new Set(campaign.maps.map((map) => map.id)),
      ).filter(
        ({ entry: { campaign } }) =>
          campaign?.campaignId === transition.campaignId && campaign.missionId === transition.mapId,
      );
      if (matches.length !== 1)
        throw new Error(
          `Sub-mission ${transition.campaignId}/${transition.mapId}: expected one map, found ${matches.length}`,
        );
      const match = matches[0];
      if (match === undefined) throw new Error('Sub-mission map is unavailable');
      target = match.entry.id;
    }
    const files = await mapFetch(target);
    const [map, source] = await Promise.all([loadTerrainMap(target, files), loadMapScript(target, files)]);
    if (map === null || source === null)
      throw new Error(`Sub-mission ${target}: map or script is unavailable`);
    if (parent !== undefined) {
      if (relaunchSearch(parent.header) === null) throw new Error('Parent mission cannot be relaunched');
      restoreMapWorld({ map, script: mapScriptWorld(source, ir), ir, content }, parent);
      return parent;
    }
    const params = new URLSearchParams(inputs.params);
    for (const key of ['scene', 'center', 'intro']) params.delete(key);
    params.set('map', target);
    const session = mapSession(params, mapLobbySlots(source));
    const seated = sessionMapScript(session, source, ir);
    const world = buildMapWorld({
      map,
      playerRoster: seated.script?.players ?? [],
      specialItems: source.specialItems,
      script: seated.world,
      ir,
      content,
      seatTribes: seated.remap,
      ...sessionWorldOptions(session, source, seated.world),
      seed: current.header.seed,
      missions: onOffParam(params, 'missions'),
      demoOwner: localPlayerOf(session),
    });
    return exportSaveGame(world.sim, { mapId: target, entry: `?${params}`, parent: current });
  };
}
