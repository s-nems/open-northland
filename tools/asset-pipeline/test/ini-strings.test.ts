import { describe, expect, it } from 'vitest';
import {
  decodeIni,
  extractStringnById,
  extractStringTable,
  latin1ToCp1250,
  parseIniSections,
} from '../src/decoders/ini.js';

describe('extractStringTable', () => {
  it('walks stringn (explicit id) and bare string (auto-increment) into { id: text }', () => {
    const table = extractStringTable(
      parseIniSections('[text]\nstringn 5 "Five"\nstring "Six"\nstringn 0 "Zero"\nstring "One"\n'),
    );
    expect(table).toEqual({ 5: 'Five', 6: 'Six', 0: 'Zero', 1: 'One' });
  });

  it('scales ids by the [control] stringidmultiplier', () => {
    const table = extractStringTable(
      parseIniSections('[control]\nstringidmultiplier 10\n[text]\nstringn 2 "Twenty"\n'),
    );
    expect(table).toEqual({ 20: 'Twenty' });
  });

  it('drops only a malformed stringn line, not the bare strings that follow it', () => {
    // A non-numeric `stringn` id must NOT poison the running id — the following bare `string`
    // still lands on the id set by the last VALID `stringn`.
    const table = extractStringTable(
      parseIniSections('[text]\nstringn 3 "Three"\nstringn zz "Bad"\nstring "Four"\n'),
    );
    expect(table).toEqual({ 3: 'Three', 4: 'Four' });
  });

  it('yields an empty table for sections without a [text] block', () => {
    expect(extractStringTable(parseIniSections('[control]\nstringidmultiplier 1\n'))).toEqual({});
    expect(extractStringTable([])).toEqual({});
  });

  it('keeps CP1250 text intact through the readable-.ini seam (decodeIni)', () => {
    // "BŁĘKITNY" as CP1250 bytes (Ł=0xA3, Ę=0xCA) — the real map strings.ini codepage.
    const bytes = Uint8Array.from('[text]\nstringn 0 "B\xa3\xcaKITNY"\n', (c) => c.charCodeAt(0) & 0xff);
    const table = extractStringTable(parseIniSections(decodeIni(bytes)));
    expect(table[0]).toBe('BŁĘKITNY');
  });
});

describe('extractStringnById (singular-only, multiplier-free)', () => {
  it('keys each explicit stringn line by its own id and ignores the bare string plurals', () => {
    const table = extractStringnById(
      parseIniSections('[text]\nstringn 5 "Wood"\nstring "Woods"\nstringn 22 "Fish"\nstring "Fishes"\n'),
    );
    expect(table).toEqual({ 5: 'Wood', 22: 'Fish' });
  });

  it('does not collide when a gapped stringn shares a multiplier-2 plural slot (the mead case)', () => {
    // The real goods name table (stringidmultiplier 2) lists mead's `stringn 43` BEFORE the 42-sword block,
    // so under extractStringTable the sword's plural auto-increment (id 43 → slot 86) clobbers mead's own
    // singular (also slot 86). Reading singulars only keeps mead by its own `stringn` id.
    const src =
      '[control]\nstringidmultiplier 2\n[text]\nstringn 43 "Mead"\nstring "Meads"\nstringn 42 "Longsword"\nstring "Longswords"\n';
    expect(extractStringnById(parseIniSections(src))).toEqual({ 43: 'Mead', 42: 'Longsword' });
    // The shared table loses mead: 43*2 = slot 86, overwritten by Longsword's plural auto-increment.
    expect(extractStringTable(parseIniSections(src))[86]).toBe('Longswords');
  });

  it('drops malformed ids and yields empty without a [text] block', () => {
    expect(extractStringnById(parseIniSections('[text]\nstringn zz "Bad"\nstringn 1 "One"\n'))).toEqual({
      1: 'One',
    });
    expect(extractStringnById([])).toEqual({});
  });
});

describe('latin1ToCp1250', () => {
  it('re-decodes byte-preserving latin1 as CP1250 display text', () => {
    // 0xB3 is ³ in latin1 but ł in CP1250 — the .cif seam decodes latin1, display needs CP1250.
    expect(latin1ToCp1250('B\xb3\xeakitny')).toBe('Błękitny');
  });
});
