import { describe, expect, it } from 'vitest';
import {
  decodeDisplayText,
  extractStringnNames,
  extractStringTable,
  iniBytesToSections,
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
    // A non-numeric `stringn` id must NOT poison the running id - the following bare `string`
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

  it('keeps CP1250 text intact through the readable-.ini seam (iniBytesToSections)', () => {
    // "BŁĘKITNY" as CP1250 bytes (Ł=0xA3, Ę=0xCA) - the real map strings.ini codepage.
    const bytes = Uint8Array.from('[text]\nstringn 0 "B\xa3\xcaKITNY"\n', (c) => c.charCodeAt(0) & 0xff);
    const table = extractStringTable(iniBytesToSections(bytes));
    expect(table[0]).toBe('BŁĘKITNY');
  });
});

describe('extractStringnNames (multiplier-free, plural from the following string row)', () => {
  it('keys each explicit stringn line by its own id and its plural by the same id', () => {
    const names = extractStringnNames(
      parseIniSections('[text]\nstringn 5 "Wood"\nstring "Woods"\nstringn 22 "Fish"\nstring "Fishes"\n'),
    );
    expect(names).toEqual({ singular: { 5: 'Wood', 22: 'Fish' }, plural: { 5: 'Woods', 22: 'Fishes' } });
  });

  it('does not collide when a gapped stringn shares a multiplier-2 plural slot (the mead case)', () => {
    // The real goods name table (stringidmultiplier 2) lists mead's `stringn 43` BEFORE the 42-sword block,
    // so under extractStringTable the sword's plural auto-increment (id 43 → slot 86) clobbers mead's own
    // singular (also slot 86). Reading by `stringn` id keeps mead by its own id.
    const src =
      '[control]\nstringidmultiplier 2\n[text]\nstringn 43 "Mead"\nstring "Meads"\nstringn 42 "Longsword"\nstring "Longswords"\n';
    expect(extractStringnNames(parseIniSections(src)).singular).toEqual({ 43: 'Mead', 42: 'Longsword' });
    // The shared table loses mead: 43*2 = slot 86, overwritten by Longsword's plural auto-increment.
    expect(extractStringTable(parseIniSections(src))[86]).toBe('Longswords');
  });

  it('takes only a string row directly after a stringn as its plural', () => {
    const names = extractStringnNames(
      parseIniSections(
        '[text]\nstring "Lead"\nstringn 1 "One"\nstring "Ones"\nstring "Extra"\nstringn 2 "Two"\n',
      ),
    );
    expect(names).toEqual({ singular: { 1: 'One', 2: 'Two' }, plural: { 1: 'Ones' } });
  });

  it('drops malformed ids with their plural and yields empty without a [text] block', () => {
    expect(
      extractStringnNames(parseIniSections('[text]\nstringn zz "Bad"\nstring "Bads"\nstringn 1 "One"\n')),
    ).toEqual({ singular: { 1: 'One' }, plural: {} });
    expect(extractStringnNames([])).toEqual({ singular: {}, plural: {} });
  });
});

describe('decodeDisplayText', () => {
  it('re-decodes byte-preserving latin1 as CP1250 display text', () => {
    // 0xB3 is ³ in latin1 but ł in CP1250 - the .cif seam decodes latin1, display needs CP1250.
    expect(decodeDisplayText('B\xb3\xeakitny')).toBe('Błękitny');
  });
});
