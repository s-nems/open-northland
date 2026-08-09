/**
 * Parser for dmrender's `-e` event dump: one JSON object per line, either a player identity row
 * (`inst`) or a timed message with `t` in frames at the render rate.
 */

export interface EventInstance {
  readonly id: number;
  /** Collection-level INFO name of the DLS the band references. */
  readonly dls: string;
  readonly bankLo: number;
  readonly bankHi: number;
  readonly patch: number;
  /** Band volume as the squared 0-127 byte fraction, as the players receive it. */
  readonly vol: number;
  /** Band pan in [-1, 1]. */
  readonly pan: number;
}

export type TimedEvent =
  | { readonly e: 'on'; readonly t: number; readonly id: number; readonly note: number; readonly vel: number }
  | { readonly e: 'off'; readonly t: number; readonly id: number; readonly note: number }
  | { readonly e: 'cc'; readonly t: number; readonly id: number; readonly cc: number; readonly val: number }
  | { readonly e: 'pb'; readonly t: number; readonly id: number; readonly val: number }
  | { readonly e: 'alloff'; readonly t: number; readonly id: number };

export interface SegmentEvents {
  readonly instances: readonly EventInstance[];
  /** In dump order, which is chronological. */
  readonly events: readonly TimedEvent[];
}

function num(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`event dump: missing numeric "${key}"`);
  }
  return value;
}

export function parseEventDump(text: string): SegmentEvents {
  const instances: EventInstance[] = [];
  const events: TimedEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('event dump: non-object row');
    const row = parsed as Record<string, unknown>;
    switch (row.e) {
      case 'inst': {
        const dls = row.dls;
        if (typeof dls !== 'string') throw new Error('event dump: inst row without dls name');
        instances.push({
          id: num(row, 'id'),
          dls,
          bankLo: num(row, 'bankLo'),
          bankHi: num(row, 'bankHi'),
          patch: num(row, 'patch'),
          vol: num(row, 'vol'),
          pan: num(row, 'pan'),
        });
        break;
      }
      case 'on':
        events.push({
          e: 'on',
          t: num(row, 't'),
          id: num(row, 'id'),
          note: num(row, 'note'),
          vel: num(row, 'vel'),
        });
        break;
      case 'off':
        events.push({ e: 'off', t: num(row, 't'), id: num(row, 'id'), note: num(row, 'note') });
        break;
      case 'cc':
        events.push({
          e: 'cc',
          t: num(row, 't'),
          id: num(row, 'id'),
          cc: num(row, 'cc'),
          val: num(row, 'val'),
        });
        break;
      case 'pb':
        events.push({ e: 'pb', t: num(row, 't'), id: num(row, 'id'), val: num(row, 'val') });
        break;
      case 'alloff':
        events.push({ e: 'alloff', t: num(row, 't'), id: num(row, 'id') });
        break;
      default:
        throw new Error(`event dump: unknown row type ${String(row.e)}`);
    }
  }
  return { instances, events };
}
