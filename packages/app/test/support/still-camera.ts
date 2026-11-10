import type { CameraGestures } from '../../src/view/camera/index.js';

/** Camera gestures that take nothing, for a modal or controller whose test moves no map. */
export const STILL_CAMERA: CameraGestures = { key: () => false, press: () => {}, wheel: () => {} };
