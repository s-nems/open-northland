import { cifBytesToSections, gfxHouseRecords, type RuleSection } from '@open-northland/formats/ini';
import { BASE_BUILDING_GRAPHICS_FILE } from '../data-layout.js';
import { readSourceFile, resolveSourceFile, type SourceRoots } from '../roots.js';

function editNameOf(record: RuleSection): string | undefined {
  return record.props.find((p) => p.key === 'EditName')?.values[0];
}

/**
 * The base `[GfxHouse]` records whose exact `EditName` no rule record defines. The rule record wins a
 * name both tables define; a name only the base defines (a house the mod dropped that original maps
 * still place) keeps its base record.
 */
export function baseOnlyHouseRecords(
  base: readonly RuleSection[],
  rules: readonly RuleSection[],
): RuleSection[] {
  const ruled = new Set<string>();
  for (const record of gfxHouseRecords(rules)) {
    const name = editNameOf(record);
    if (name !== undefined) ruled.add(name);
  }
  return [...gfxHouseRecords(base)].filter((record) => {
    const name = editNameOf(record);
    return name !== undefined && !ruled.has(name);
  });
}

/** {@link baseOnlyHouseRecords} read from the base `.cif` house table; an absent table yields none. */
export async function loadBaseOnlyHouseRecords(
  roots: SourceRoots,
  rules: readonly RuleSection[],
): Promise<RuleSection[]> {
  const path = await resolveSourceFile(roots, BASE_BUILDING_GRAPHICS_FILE);
  if (path === undefined) return [];
  return baseOnlyHouseRecords(cifBytesToSections(await readSourceFile(roots, path)), rules);
}
