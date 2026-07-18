/**
 * Camera helpers shared by the map (`entries/map.ts`) and shot (`entries/shot.ts`) entries, split by
 * concern behind this barrel so import paths stay `view/camera/…`:
 *
 * - `frame.ts` — the pure static starting-frame builders (`cameraFor` and the centred-on-tile/world
 *   variants).
 * - `pan-zoom.ts` — the pure interactive pan/zoom reducers + their bounds/tuning, unit-tested headless.
 * - `screen-scale.ts` — the CSS-px → Pixi-screen-px mapping every drag/pick/hit-test rides on.
 * - `controller.ts` — the DOM controller that wraps the reducers around live mouse/wheel/key input.
 */

export { type CameraController, createCameraController } from './controller.js';
export {
  cameraCenteredOnTile,
  cameraCenteredOnWorld,
  cameraFor,
} from './frame.js';
export {
  type CameraTuning,
  DEFAULT_CAMERA_TUNING,
  EDGE_SCROLL_MARGIN,
  edgePanVelocity,
  MAX_ZOOM,
  MIN_ZOOM,
  panCamera,
  stepZoomToward,
  zoomCameraAt,
} from './pan-zoom.js';
export { clientToScreen, screenScale } from './screen-scale.js';
