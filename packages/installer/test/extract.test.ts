import { describe, expect, it } from 'vitest';
import { zipMemberRelPath } from '../src/mod-install/extract.js';

describe('zipMemberRelPath', () => {
  it('keeps normal member paths and rejects escapes', () => {
    expect(zipMemberRelPath('CnMod 1.3.1/DataCnmd/types/houses.ini')).toBe(
      'CnMod 1.3.1/DataCnmd/types/houses.ini',
    );
    expect(zipMemberRelPath('../evil')).toBeUndefined();
    expect(zipMemberRelPath('/abs')).toBeUndefined();
    expect(zipMemberRelPath('C:evil')).toBeUndefined(); // Windows drive-relative, not caught by isAbsolute
    expect(zipMemberRelPath('')).toBeUndefined();
  });
});
