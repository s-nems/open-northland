export type RelayRegionId = 'eu' | 'na' | 'ap';

export interface RelayRegion {
  readonly id: RelayRegionId;
  readonly url: string;
}

const EUROPE: RelayRegion = { id: 'eu', url: 'wss://relay-eu.opennorthland.org' };
const NORTH_AMERICA: RelayRegion = { id: 'na', url: 'wss://relay-na.opennorthland.org' };
const ASIA: RelayRegion = { id: 'ap', url: 'wss://relay-ap.opennorthland.org' };

/** The official relays in the order the menu lists them; the first serves until a ping answers. */
export const RELAY_REGIONS: readonly RelayRegion[] = [EUROPE, NORTH_AMERICA, ASIA];
export const DEFAULT_RELAY_REGION = EUROPE;

/** The official region `address` names, or undefined for a custom server. */
export function relayRegionAt(address: string): RelayRegion | undefined {
  const trimmed = address.trim().replace(/\/$/, '');
  return RELAY_REGIONS.find((region) => region.url === trimmed);
}

/** The region with the lowest answered ping; undefined while none answered. */
export function fastestRegion(pings: ReadonlyMap<RelayRegionId, number | null>): RelayRegion | undefined {
  let best: { region: RelayRegion; ms: number } | undefined;
  for (const region of RELAY_REGIONS) {
    const ms = pings.get(region.id);
    if (ms === undefined || ms === null) continue;
    if (best === undefined || ms < best.ms) best = { region, ms };
  }
  return best?.region;
}
