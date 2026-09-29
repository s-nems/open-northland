import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapScript, realMapWorld } from './real-map-world.js';

/** A desert map whose `[misc_weather]` lays down sand, one rectangle authored right to left. */
const SAND_MAP_ID = 'saracen_4';

it.runIf(hasRealIr() && existsSync(realMapPath(SAND_MAP_ID)))(
  "starts a map with its [misc_weather] sand in the world's saved presentation",
  async () => {
    const authored = realMapScript(SAND_MAP_ID)?.weather ?? [];
    expect(authored.length).toBeGreaterThan(0);
    expect(authored.every((region) => region.weather === 'sand')).toBe(true);
    const { sim } = await realMapWorld({ mapId: SAND_MAP_ID, aiSeats: [] });
    expect(sim.missionPresentation().weather).toEqual(authored);
  },
);
