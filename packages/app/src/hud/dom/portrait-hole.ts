/** The part of the canvas a DOM window leaves open for the renderer, in client (CSS) px. */
export interface ClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const HOLE_AXES = ['x', 'y', 'w', 'h'] as const;

/**
 * Open the fill's hole named `name` over `frame`'s padding box, since the plane lies over the canvas
 * and the renderer paints the live cutout under it. The fill's mask reads `--{name}-x/y/w/h` in design
 * px (foundation.css); the frame's client box is returned for the renderer. Reads the layout, so it
 * runs once per change of the box, never per frame.
 */
export function cutPortraitHole(fill: HTMLElement, frame: HTMLElement, name: string): ClientRect {
  const frameBox = frame.getBoundingClientRect();
  const fillBox = fill.getBoundingClientRect();
  // Client px per design px: the plane is scaled as a whole.
  const scale = fill.offsetWidth === 0 ? 1 : fillBox.width / fill.offsetWidth;
  const design = {
    x: (frameBox.left - fillBox.left) / scale + frame.clientLeft,
    y: (frameBox.top - fillBox.top) / scale + frame.clientTop,
    w: frame.clientWidth,
    h: frame.clientHeight,
  };
  for (const axis of HOLE_AXES) fill.style.setProperty(`--${name}-${axis}`, `${design[axis]}px`);
  return {
    left: frameBox.left + frame.clientLeft * scale,
    top: frameBox.top + frame.clientTop * scale,
    width: frame.clientWidth * scale,
    height: frame.clientHeight * scale,
  };
}

/** Close the hole: the fill paints whole again. */
export function closePortraitHole(fill: HTMLElement, name: string): void {
  for (const axis of HOLE_AXES) fill.style.removeProperty(`--${name}-${axis}`);
}
