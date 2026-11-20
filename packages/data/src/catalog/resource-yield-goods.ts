/** The content goods whose map-placed stock each resource richness rule multiplies. Project choice:
 *  the everyday building and food resources in one group, the two ores in the other. */
export const RESOURCE_YIELD_GOODS = {
  basic: ['wood', 'mushroom', 'mud', 'stone'],
  ore: ['iron', 'gold'],
} as const satisfies Readonly<Record<string, readonly string[]>>;
