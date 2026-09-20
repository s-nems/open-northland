import { describe, expect, it } from 'vitest';
import { ARROW } from '../../src/gpu/sprite-pool/placeholder.js';

/** Perceived brightness of a `0xRRGGBB` colour (Rec. 601 luma) - the eye's ordering, not the byte sum. */
function luma(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('the arrow marker points where it flies', () => {
  const { shaft, head, fletching } = ARROW;

  it('lets only the head reach the forward extreme', () => {
    expect(head.baseX).toBeGreaterThan(0); // the whole head sits in the forward half
    expect(head.tipX).toBeGreaterThan(head.baseX);
    const behind = [shaft.tailX, head.baseX, fletching.apexX, fletching.endX];
    expect(Math.max(...behind)).toBeLessThan(head.tipX); // nothing else reaches as far forward
  });

  it('uses restrained natural materials while keeping the iron head readable', () => {
    expect(luma(head.colour)).toBeGreaterThan(luma(shaft.colour));
    expect(luma(head.colour)).toBeGreaterThan(luma(fletching.colour));
    expect(luma(head.edgeColour)).toBeLessThan(luma(head.colour));
  });

  it('sweeps the feathers back from their apex, so the tail cannot read as a head', () => {
    expect(fletching.endX).toBeLessThan(fletching.apexX); // the arms trail behind the apex
    expect(fletching.apexX).toBeLessThan(0); // and the whole tuft sits behind the arrow's middle
    expect(fletching.halfSpan).toBeGreaterThan(0); // it fans out rather than doubling back on the shaft
    expect(fletching.innerX).toBeGreaterThan(fletching.endX); // each feather tapers back into the shaft
  });

  it('keeps the shaft spanning tail to head, with no gap either end', () => {
    expect(shaft.tailX).toBeLessThanOrEqual(fletching.endX); // the feathers end no further back
    expect(head.baseX).toBeGreaterThan(shaft.tailX); // and the shaft runs forward into the head
  });

  it('stays slim and actor-scale instead of reading as an oversized icon', () => {
    const length = head.tipX - shaft.tailX;
    expect(length).toBeLessThanOrEqual(24); // the fallback settler body is 24 px tall
    expect(head.halfSpan * 2).toBeLessThanOrEqual(length / 8);
    expect(fletching.halfSpan).toBeLessThanOrEqual(head.halfSpan);
    expect(shaft.width).toBeLessThan(head.halfSpan);
  });
});
