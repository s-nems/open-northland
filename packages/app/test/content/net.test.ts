import { afterEach, describe, expect, it, vi } from 'vitest';
import { modAssetBlobUrl } from '../../src/content/net.js';

describe('mod asset URLs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sets the PNG MIME type on modded atlas blobs', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/atlas');
    const url = modAssetBlobUrl('/bobs/viking.png', new Uint8Array([1, 2, 3]));

    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (blob instanceof Blob) expect(blob.type).toBe('image/png');
    expect(url).toBe('blob:http://localhost/atlas');
  });

  it('sets the WebP MIME type too', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/atlas');
    const url = modAssetBlobUrl('/bobs/viking.webp', new Uint8Array([1]));

    const blob = create.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (blob instanceof Blob) expect(blob.type).toBe('image/webp');
    expect(url).toBe('blob:http://localhost/atlas');
  });
});
