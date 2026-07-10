// Unit body collision — the WHO/WHERE read-model (bodies.ts: colliders, posts, calm zones, the
// routing walk overlay) and the per-tick physical resolve (separation.ts: separationSystem). Split
// so routing and combat consume the model without importing the system.
export * from './bodies.js';
export * from './separation.js';
