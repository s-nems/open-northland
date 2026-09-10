import { relayConfigFromEnvironment } from './host/config.js';
import { startRelayHost } from './host/ws-host.js';

/** One JSON line per event, for a log collector to read as a record. */
function logLine(event: string, fields?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

const host = await startRelayHost({ ...relayConfigFromEnvironment(process.env), log: logLine });

const stop = (signal: string): void => {
  logLine('stopping', { signal });
  host.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
