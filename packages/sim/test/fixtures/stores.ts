// ONE implementation: packages/sim/src/harness/stores.ts (exported from the package index, so the
// app-level multi-sim tests share it too). This fixture path survives as a re-export for the sim
// suite's existing imports.
export { clearComponentStores } from '../../src/index.js';
