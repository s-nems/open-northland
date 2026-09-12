/** Track the latest pointer position for per-frame hover/placement work without doing it on mousemove. */
export function trackCanvasPointer(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): () => { readonly clientX: number; readonly clientY: number } | null {
  let pointer: { clientX: number; clientY: number } | null = null;
  canvas.addEventListener(
    'mousemove',
    (event) => {
      pointer = { clientX: event.clientX, clientY: event.clientY };
    },
    signal === undefined ? undefined : { signal },
  );
  canvas.addEventListener(
    'mouseleave',
    () => {
      pointer = null;
    },
    signal === undefined ? undefined : { signal },
  );
  return () => pointer;
}
