import { describe, expect, it } from 'vitest';
import { withBaseUrl } from '../src/base-url.js';

describe('public base URL', () => {
  it('places root-relative assets under the configured path', () => {
    expect(withBaseUrl('/fonts/ui.woff2', '/game/')).toBe('/game/fonts/ui.woff2');
    expect(withBaseUrl('/ir.json', '/')).toBe('/ir.json');
  });

  it('leaves non-root URLs unchanged', () => {
    expect(withBaseUrl('blob:preview', '/game/')).toBe('blob:preview');
  });
});
