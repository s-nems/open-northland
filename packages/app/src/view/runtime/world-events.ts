import type { SimEvent } from '@open-northland/sim';

type Consumer = (events: readonly SimEvent[]) => void;

/**
 * The event kinds a view keeps state from, which a worker shedding undelivered ticks must still deliver:
 * the map entry's static objects (harvestable handover, footprint clearing), its script landscapes and
 * terrain tints, the script's markers, weather and exit, and the local verdict. The rest is transient.
 */
export const DURABLE_EVENT_KINDS: readonly SimEvent['kind'][] = [
  'resourceFelled',
  'resourceMined',
  'resourceDepleted',
  'berryForaged',
  'berryBushRazed',
  'missionLandscapeResourceRemoved',
  'buildingPlaced',
  'buildingUpgraded',
  'missionLandscapeChanged',
  'missionVertexColor',
  'missionGuiMarker',
  'missionAreaMarkers',
  'missionImportMarker',
  'missionWeather',
  'missionExit',
  'playerWon',
  'playerDefeated',
];

export function createWorldEventHandler(options: {
  forward: Consumer;
  terrainColors: Consumer;
  subMissions: (events: readonly SimEvent[]) => boolean;
  verdict: Consumer;
  presentation: Consumer;
}): Consumer {
  return (events) => {
    options.forward(events);
    options.terrainColors(events);
    // Presentation runs before a transition claims the batch: a failed transition keeps the player in
    // this world, with the markers and pages the same pass raised.
    options.presentation(events);
    if (options.subMissions(events)) return;
    options.verdict(events);
  };
}
