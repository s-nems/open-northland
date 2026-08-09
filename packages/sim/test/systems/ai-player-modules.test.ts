/**
 * The strategic AI modules (user plan, 2026-07-17): the workforce allocator (builder reset +
 * resource-side flag collectors + scout lifecycle), the opening build order, the HQ signpost ring,
 * and population planning. Module runs are pure - each test inspects the returned command list
 * against a hand-built world, then the integration suite proves the full registry stays
 * deterministic and replayable.
 */
import './ai-player/build-order-execution.cases.js';
import './ai-player/build-order-placement.cases.js';
import './ai-player/garrison-and-craft.cases.js';
import './ai-player/livestock-round-up.cases.js';
import './ai-player/loss-recovery.cases.js';
import './ai-player/opening-hunter.cases.js';
import './ai-player/population.cases.js';
import './ai-player/registry-determinism.cases.js';
import './ai-player/signpost-coverage.cases.js';
import './ai-player/tower-coverage-and-outskirts.cases.js';
import './ai-player/workforce-allocation.cases.js';
