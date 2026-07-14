/**
 * The animation-gallery feature: the pure clip/layout/frame-selection math
 * ({@link import('./layout.js')}) and the retained Pixi grid view
 * ({@link import('./animation-gallery.js')}).
 */
export { AnimationGallery, type GalleryCellSpec } from './animation-gallery.js';
export {
  COMPASS_TO_BLOCK,
  clipDirs,
  GALLERY_DIRS,
  type GalleryClip,
  type GalleryDirection,
  galleryBobId,
  galleryCellLayout,
  headBobId,
} from './layout.js';
