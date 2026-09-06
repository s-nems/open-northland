import { GfxInHouseEntry, GfxInHouseProgram } from '@open-northland/data';
import type { RuleProp, RuleSection } from '../grammar.js';
import { makeSource, type SourceRef } from '../ir-fields.js';
import { getInt } from '../props.js';

/** The `gfxanimmode` value of a body-less `[gfxanimatomic]` record that scripts an indoor program. */
export const GFX_ANIM_MODE_IN_HOUSE = 2;

/** One value as a base-10 int; a missing or unparsable one reads NaN, which {@link parsed} rejects. */
function int(value: string | undefined): number {
  return Number.parseInt(value ?? '', 10);
}

/** `entry` when every one of `fields` parsed, else `undefined` - the arity and NaN check in one place. */
function parsed<T>(
  entry: T,
  fields: readonly number[],
  arity: number,
  values: readonly string[],
): T | undefined {
  return values.length === arity && !fields.some(Number.isNaN) ? entry : undefined;
}

/** One `gfxinhouse*` line as a program entry, or `undefined` for any other key or a malformed arity. */
function inHouseEntry(prop: RuleProp): GfxInHouseEntry | undefined {
  const v = prop.values;
  switch (prop.key) {
    case 'gfxinhousewalk': {
      const e = {
        kind: 'walk',
        dir: int(v[0]),
        goodType: int(v[1]),
        x: int(v[2]),
        y: int(v[3]),
        from: int(v[4]),
        to: int(v[5]),
      } as const;
      return parsed(e, [e.dir, e.goodType, e.x, e.y, e.from, e.to], 6, v);
    }
    case 'gfxinhouseanim': {
      const e = {
        kind: 'clip',
        action: int(v[0]),
        subId: int(v[1]),
        dir: int(v[2]),
        from: int(v[3]),
        to: int(v[4]),
      } as const;
      return parsed(e, [e.action, e.subId, e.dir, e.from, e.to], 5, v);
    }
    case 'gfxinhouseoverlaylandscape': {
      const name = v[0];
      if (name === undefined || name.trim() === '') return undefined;
      const e = {
        kind: 'landscape',
        name,
        x: int(v[1]),
        y: int(v[2]),
        from: int(v[3]),
        to: int(v[4]),
      } as const;
      return parsed(e, [e.x, e.y, e.from, e.to], 5, v);
    }
    case 'gfxinhouseoverlaybob': {
      const e = {
        kind: 'houseBob',
        layer: int(v[0]),
        x: int(v[1]),
        y: int(v[2]),
        from: int(v[3]),
        to: int(v[4]),
      } as const;
      return parsed(e, [e.layer, e.x, e.y, e.from, e.to], 5, v);
    }
    default:
      return undefined;
  }
}

/**
 * Extracts the `gfxanimmode 2` `[gfxanimatomic]` records of `mapmoveableanimations/animations.ini` as
 * {@link GfxInHouseProgram} rows, keeping entry file order. A record missing its tribe/job/action or
 * scripting no readable entry is skipped, so one malformed line never fails the run.
 */
export function extractGfxInHousePrograms(
  sections: readonly RuleSection[],
  src: SourceRef,
): GfxInHouseProgram[] {
  const out: GfxInHouseProgram[] = [];
  for (const sec of sections) {
    if (sec.name !== 'gfxanimatomic' || getInt(sec, 'gfxanimmode') !== GFX_ANIM_MODE_IN_HOUSE) continue;
    const tribe = getInt(sec, 'logictribe');
    const job = getInt(sec, 'logicjob');
    const action = getInt(sec, 'logicatomicaction');
    if (tribe === undefined || job === undefined || action === undefined) continue;
    const entries: GfxInHouseEntry[] = [];
    for (const prop of sec.props) {
      // Parsed one at a time: the schema's ranges are the only check on a value the grammar accepts, and
      // an out-of-range line must cost its own entry, not the whole run.
      const entry = GfxInHouseEntry.safeParse(inHouseEntry(prop));
      if (entry.success) entries.push(entry.data);
    }
    if (entries.length === 0) continue;
    out.push(
      GfxInHouseProgram.parse({ tribe, job, action, entries, source: makeSource(src, 'gfxanimatomic') }),
    );
  }
  return out;
}
