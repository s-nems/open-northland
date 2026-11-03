import { afterEach, describe, expect, it, vi } from 'vitest';
import { modAssetBlobUrl } from '../../src/content/net.js';

describe('mod asset URLs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves the image parser extension and MIME type for PNG atlas blobs', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/atlas');
    const bytes = new Uint8Array([1, 2, 3]);

    const url = modAssetBlobUrl('/bobs/viking.png', bytes);

    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/png');
    expect(url).toBe('blob:http://localhost/atlas#viking.png');
  });

  it('preserves WebP extensions and MIME types too', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/atlas');

    const url = modAssetBlobUrl('/bobs/viking.webp', new Uint8Array([1]));

    expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(create.mock.calls[0]?.[0].type).toBe('image/webp');
    expect(url).toBe('blob:http://localhost/atlas#viking.webp');
  });
});
