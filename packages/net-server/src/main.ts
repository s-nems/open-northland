import { startRelayHost } from './host/ws-host.js';

const DEFAULT_PORT = 8765;

function portFromEnvironment(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0) throw new Error(`PORT must be a port number, got ${raw}`);
  return port;
}

const host = await startRelayHost({
  port: portFromEnvironment(),
  log: (event, fields) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields })),
});

const stop = (): void => {
  host.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
