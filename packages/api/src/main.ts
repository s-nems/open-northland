import { IR_VERSION } from '@open-northland/data/ir-version';
import { loadTranslationOverlays } from '@open-northland/translations';
import { normalizeRecords } from './catalog/normalize.js';
import { firstSeenDates, normalizeMapdbRecords } from './catalog/normalize-mapdb.js';
import { parseCatalog } from './catalog/snapshot.js';
import { CatalogSync, downloadsOf } from './catalog/sync.js';
import { apiConfigFromEnvironment } from './config.js';
import { ConversionService } from './conversion/service.js';
import { ConversionStore } from './conversion/store.js';
import { WorkerArchiveConverter } from './conversion/worker-converter.js';
import { errorMessage, logLine } from './log.js';
import { ReportEndpoint } from './reports/endpoint.js';
import { type ApiServer, startApiServer } from './server.js';
import { DataStore } from './store.js';

let stopAll: () => Promise<void>;
try {
  const config = apiConfigFromEnvironment(process.env, process.cwd());
  const store = new DataStore(config.dataDir);
  await store.init();
  const { maps: mapOverlays } = await loadTranslationOverlays();
  let server: ApiServer | null = null;
  const conversions = new ConversionService({
    store: new ConversionStore(config.dataDir, IR_VERSION),
    fetch,
    converter: new WorkerArchiveConverter(config.convertTimeoutMs),
    mapOverlays,
    concurrency: config.convertConcurrency,
    publish: (snapshot) => server?.publish(snapshot),
    log: logLine,
  });
  await conversions.init();
  const reports = await ReportEndpoint.open(config.reports, logLine);
  server = await startApiServer({
    ...config,
    store,
    content: conversions,
    files: conversions,
    reports,
    log: logLine,
  });
  // The last good catalogue serves at once and converts from the kept archives; the first sync
  // replaces it when it completes. Its download URLs come from the raw pages it was made from.
  const stored = await store.readCatalog();
  if (stored !== null) {
    try {
      const catalog = parseCatalog(stored.text);
      const updatedAt = new Map(catalog.map((entry) => [entry.id, entry.updatedAt]));
      // An entry keeps its download while the stored catalogue still serves its conversion.
      const kept = ({
        entry,
      }: {
        readonly entry: { readonly id: string; readonly updatedAt: string };
      }): boolean => updatedAt.get(entry.id) === entry.updatedAt;
      const records = [
        ...normalizeRecords(await store.readRawRecords(), config.upstream).records.filter(kept),
        ...(config.mapdbUpstream === null
          ? []
          : normalizeMapdbRecords(
              await store.readRawMapdbRecords(),
              config.mapdbUpstream,
              firstSeenDates(catalog),
            ).records.filter(kept)),
      ];
      conversions.setCatalog({ catalog, downloads: downloadsOf(records), syncedAt: stored.writtenAt });
    } catch (error) {
      logLine('stored catalogue refused', { error: errorMessage(error) });
    }
  }
  const sync = new CatalogSync(
    { fetch, upstream: config.upstream, mapdbUpstream: config.mapdbUpstream, store, log: logLine },
    config.syncIntervalMs,
    (synced) => conversions.setCatalog(synced),
  );
  sync.start();
  logLine('started', {
    dataDir: config.dataDir,
    upstream: config.upstream,
    syncIntervalMs: config.syncIntervalMs,
    convertConcurrency: config.convertConcurrency,
    reportsDir: config.reports.dir,
    trustForwardedFor: config.reports.trustForwardedFor,
    irVersion: IR_VERSION,
    overlaidMaps: mapOverlays.size,
  });
  const running = server;
  stopAll = async () => {
    await Promise.all([running.close(), sync.stop(), conversions.stop()]);
    await reports.close();
  };
} catch (error) {
  logLine('start failed', { error: errorMessage(error) });
  process.exit(1);
}

const stop = (signal: string): void => {
  logLine('stopping', { signal });
  stopAll().then(
    () => process.exit(0),
    (error: unknown) => {
      logLine('stop failed', { error: errorMessage(error) });
      process.exit(1);
    },
  );
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
