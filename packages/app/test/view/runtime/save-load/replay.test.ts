import { adminCommand, exportSaveGame, Simulation, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../../../../sim/test/fixtures/content.js';
import {
  parseReplayDocument,
  REPLAY_FORMAT_VERSION,
  REPLAY_KIND,
  type ReplayDocument,
  replayDocumentTextOf,
  replaySessionOf,
} from '../../../../src/view/runtime/save-load/replay.js';

/**
 * A replay document round-trips through the text its capture assembles, and a reader refuses any
 * other kind, version or malformed entry before the boot spends its time standing a world up.
 */

const MAP_ID = 'magical-forest';

function descriptorOf(mapId: string) {
  return {
    world: { kind: 'map' as const, mapId },
    seed: 5,
    seats: [{ player: 0, mode: 'human' as const, color: 0 }],
    localSeat: 0,
    rules: {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
      storageCapacity: null,
      basicYield: null,
      oreYield: null,
      papers: null,
    },
    speed: 1,
  };
}

function documentTextOf(parts: {
  readonly fromTick: number;
  readonly untilTick: number;
  readonly initialSaveText?: string | null;
  readonly logText?: string;
}): string {
  return replayDocumentTextOf({
    savedAt: 1764240000000,
    startedAt: 1764239000000,
    irVersion: 7,
    identity: { clientBuild: 'test-build', gameVersion: '9.9.9-test', contentFingerprint: 'content-x' },
    mapFingerprint: null,
    stateHash: 'abcd0123',
    descriptor: descriptorOf(MAP_ID),
    fromTick: parts.fromTick,
    untilTick: parts.untilTick,
    initialSaveText: parts.initialSaveText ?? null,
    logText: parts.logText ?? '[]',
  });
}

/** A two-tick session's recording: the world build's tick, then one logged command. */
function recordedText(): string {
  const sim = new Simulation({ seed: 5, content: testContent() });
  sim.step();
  sim.commands.discardPending();
  sim.enqueueAt(adminCommand({ kind: 'setNeedsEnabled', enabled: false }), sim.tick + 1, 0);
  sim.step();
  return replayDocumentTextOf({
    savedAt: 1764240000000,
    startedAt: 1764239000000,
    irVersion: 7,
    identity: { clientBuild: 'test-build', gameVersion: '9.9.9-test', contentFingerprint: 'content-x' },
    mapFingerprint: null,
    stateHash: 'abcd0123',
    descriptor: descriptorOf(MAP_ID),
    fromTick: 1,
    untilTick: sim.tick,
    initialSaveText: null,
    logText: sim.commands.logText(),
  });
}

describe('replay document', () => {
  it('round-trips the capture text through the parser', () => {
    const parsed = parseReplayDocument(recordedText());
    expect(parsed.kind).toBe(REPLAY_KIND);
    expect(parsed.version).toBe(REPLAY_FORMAT_VERSION);
    expect(parsed.irVersion).toBe(7);
    expect(parsed.identity).toEqual({
      clientBuild: 'test-build',
      gameVersion: '9.9.9-test',
      contentFingerprint: 'content-x',
    });
    expect(parsed.mapFingerprint).toBeNull();
    expect(parsed.stateHash).toBe('abcd0123');
    expect(parsed.fromTick).toBe(1);
    expect(parsed.untilTick).toBe(2);
    expect(parsed.initialSave).toBeNull();
    expect(parsed.descriptor.world).toEqual({ kind: 'map', mapId: MAP_ID });
    expect(parsed.log.map((entry) => [entry.applyTick, entry.sequence])).toEqual([[2, 0]]);
  });

  it('embeds a restored save verbatim and hands it back as text', () => {
    const sim = new Simulation({ seed: 3, content: testContent() });
    sim.step();
    const saveText = serializeSaveGame(exportSaveGame(sim));
    const parsed = parseReplayDocument(
      documentTextOf({ fromTick: 1, untilTick: 1, initialSaveText: saveText }),
    );
    expect(parsed.initialSave).toEqual(JSON.parse(saveText));
  });

  it('refuses another kind and version', () => {
    expect(() => parseReplayDocument('{"kind":"open-northland-save"}')).toThrow(/not a replay/);
    expect(() => parseReplayDocument(recordedText().replace('"version":3', '"version":4'))).toThrow(
      /unsupported replay format version/,
    );
  });

  it('refuses a log entry that carries no command or a negative tick', () => {
    const broken = documentTextOf({
      fromTick: 0,
      untilTick: 5,
      logText:
        '[{"v":2,"origin":"admin","command":{},"applyTick":2,"sequence":0},' +
        '{"v":2,"origin":"admin","command":{},"applyTick":-3,"sequence":1}]',
    });
    expect(() => parseReplayDocument(broken)).toThrow(/applyTick/);
  });

  it('plays a recorded session back as a spectator seat', () => {
    const parsed: ReplayDocument = parseReplayDocument(recordedText());
    const session = replaySessionOf(parsed.descriptor);
    expect(session.localSeat).toBe('observer');
    expect(session.world).toEqual({ kind: 'map', mapId: MAP_ID });
  });
});
