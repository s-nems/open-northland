/** Each figure canvas's 2d context, fetched once and resized to the backing size a frame asks for. */
export class CanvasContexts {
  private readonly contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

  /** `canvas`'s context at `width` x `height` device px; null when the canvas gives none. */
  sized(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
    let ctx = this.contexts.get(canvas);
    if (ctx === undefined) {
      const got = canvas.getContext('2d');
      if (got === null) return null;
      ctx = got;
      this.contexts.set(canvas, ctx);
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return ctx;
  }
}
