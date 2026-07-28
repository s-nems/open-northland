#!/usr/bin/env node
// Runner for the synthetic simulation benchmark (docs/TESTING.md "Benchmarks and long runs").
import { rebuildWorkspace, runBenchFile } from './bench-run.mjs';

rebuildWorkspace();
runBenchFile('sim-tick');
