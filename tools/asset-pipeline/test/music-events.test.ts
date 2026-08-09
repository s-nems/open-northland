import { describe, expect, it } from 'vitest';
import { parseEventDump } from '../src/stages/music/events.js';

describe('parseEventDump', () => {
  it('separates instances from timed events and keeps dump order', () => {
    const dump = [
      '{"e":"inst","id":1,"dls":"Flute","bankLo":1,"bankHi":0,"patch":72,"vol":0.5,"pan":-0.5}',
      '{"e":"on","t":0,"id":1,"note":60,"vel":100}',
      '{"e":"cc","t":10,"id":1,"cc":7,"val":0.5}',
      '{"e":"pb","t":20,"id":1,"val":9000}',
      '{"e":"off","t":30,"id":1,"note":60}',
      '{"e":"alloff","t":40,"id":1}',
    ].join('\n');
    const parsed = parseEventDump(dump);
    expect(parsed.instances).toEqual([
      { id: 1, dls: 'Flute', bankLo: 1, bankHi: 0, patch: 72, vol: 0.5, pan: -0.5 },
    ]);
    expect(parsed.events.map((e) => e.e)).toEqual(['on', 'cc', 'pb', 'off', 'alloff']);
    expect(parsed.events[3]).toEqual({ e: 'off', t: 30, id: 1, note: 60 });
  });

  it('rejects unknown rows and missing fields', () => {
    expect(() => parseEventDump('{"e":"boom","t":0}')).toThrow('unknown row type');
    expect(() => parseEventDump('{"e":"on","t":0,"id":1,"note":60}')).toThrow('missing numeric "vel"');
  });
});
