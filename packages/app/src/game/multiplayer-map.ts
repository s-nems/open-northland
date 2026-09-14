import { decodeMissionResult, type MapScript } from '@open-northland/data';

/** A network world must declare its lobby and stay on the map pinned by the session descriptor. */
export function assertMultiplayerMap(script: MapScript | null): void {
  if (script?.multiplayer === undefined) throw new Error('This map is single-player only');
  for (const mission of script.missions) {
    for (const line of mission.results) {
      const result = decodeMissionResult(line);
      if (result.opcode === 'StartSubMission' || result.opcode === 'EndSubMission') {
        throw new Error('Multiplayer map transitions are not supported');
      }
    }
  }
}
