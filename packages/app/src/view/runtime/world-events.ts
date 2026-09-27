import type { SimEvent } from '@open-northland/sim';

type Consumer = (events: readonly SimEvent[]) => void;

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
