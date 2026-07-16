import { describe, expect, it } from 'vitest';
import { type DiagEntry, DiagLog } from '../src/diag/index.js';

/** A capturing console sink: records `level` + args instead of printing. */
function captureConsole(): {
  calls: { level: string; args: unknown[] }[];
  sink: ConstructorParameters<typeof DiagLog>[0];
} {
  const calls: { level: string; args: unknown[] }[] = [];
  const method =
    (level: string) =>
    (...args: unknown[]): void => {
      calls.push({ level, args });
    };
  return {
    calls,
    sink: {
      console: { debug: method('debug'), info: method('info'), warn: method('warn'), error: method('error') },
    },
  };
}

describe('DiagLog', () => {
  it('retains entries in order and drops the oldest beyond ringCapacity', () => {
    const log = new DiagLog({ ringCapacity: 3, consoleLevel: 'silent' });
    for (let i = 0; i < 5; i++) log.info('test', `message ${i}`);
    expect(log.entries().map((e) => e.message)).toEqual(['message 2', 'message 3', 'message 4']);
  });

  it('produces JSON-serializable entries, normalizing Error data to a plain object', () => {
    const log = new DiagLog({ consoleLevel: 'silent', now: () => 42 });
    log.warn('content', 'atlas failed', new Error('boom'));
    log.info('boot', 'environment', { href: 'http://x/', dpr: 2 });
    const revived = JSON.parse(JSON.stringify(log.entries())) as DiagEntry[];
    expect(revived).toHaveLength(2);
    expect(revived[0]).toMatchObject({
      timeMs: 42,
      channel: 'content',
      level: 'warn',
      message: 'atlas failed',
      data: { name: 'Error', message: 'boom' },
    });
    expect((revived[0]?.data as { stack?: string } | undefined)?.stack).toBeTypeOf('string');
    expect(revived[1]?.data).toEqual({ href: 'http://x/', dpr: 2 });
  });

  it('echoes only entries at or above the console level, while the ring keeps everything', () => {
    const { calls, sink } = captureConsole();
    const log = new DiagLog({ ...sink });
    log.debug('test', 'quiet');
    log.info('test', 'shown');
    log.error('test', 'loud');
    expect(calls.map((c) => c.level)).toEqual(['info', 'error']);
    expect(log.entries()).toHaveLength(3);
  });

  it('lets a per-channel console level override the global one', () => {
    const { calls, sink } = captureConsole();
    const log = new DiagLog({ ...sink });
    log.setConsoleLevel('silent', 'chatty');
    log.setConsoleLevel('debug', 'verbose');
    log.warn('chatty', 'suppressed');
    log.debug('verbose', 'shown');
    log.info('other', 'shown too');
    expect(calls.map((c) => c.args[0])).toEqual(['[verbose] shown', '[other] shown too']);
    expect(log.entries()).toHaveLength(3);
  });

  it('prefixes the channel and forwards data to the console sink', () => {
    const { calls, sink } = captureConsole();
    const log = new DiagLog({ ...sink });
    const err = new Error('boom');
    log.warn('content', 'atlas failed', err);
    expect(calls[0]?.args).toEqual(['[content] atlas failed', err]);
  });
});
