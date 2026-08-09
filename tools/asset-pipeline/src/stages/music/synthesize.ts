/**
 * Offline synthesis of a dmrender event dump through spessasynth_core using the game's own DLS
 * banks. Each band instrument becomes one MIDI channel (a bank's 17th instance opens another
 * processor); notes falling in regions the download validation rejects stay silent.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BasicPreset,
  type BasicSoundBank,
  type MIDIController,
  SoundBankLoader,
  SpessaSynthProcessor,
} from 'spessasynth_core';
import {
  type DlsInstrumentRejects,
  type DlsKeyRange,
  decodeBankName,
  decodeRejectedRegions,
} from '../../decoders/dls.js';
import type { SegmentEvents } from './events.js';

export interface DlsBank {
  readonly file: string;
  readonly bank: BasicSoundBank;
  readonly rejected: readonly DlsInstrumentRejects[];
}

/** Every collection under `dir`, keyed by its INFO name (the identity the event dump carries). */
export async function loadDlsBanks(dir: string): Promise<Map<string, DlsBank>> {
  const banks = new Map<string, DlsBank>();
  for (const file of (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.dls')).sort()) {
    const bytes = await readFile(join(dir, file));
    const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const name = decodeBankName(view);
    if (name === undefined) continue;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    banks.set(name, {
      file,
      bank: SoundBankLoader.fromArrayBuffer(buffer),
      rejected: decodeRejectedRegions(view),
    });
  }
  return banks;
}

/** spessasynth renders in fixed quanta; events are applied at quantum boundaries (~3 ms). */
const SYNTH_QUANTUM = 128;
const MIDI_CHANNELS_PER_PROCESSOR = 16;
const CC_BANK_MSB = 0;
const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_BANK_LSB = 32;
const CC_REVERB_SEND = 91;
const CC_ALL_NOTES_OFF = 123;
const MIDI_MAX = 127;
const PAN_CENTER = 63;
const PITCH_WHEEL_MAX = 16383;

interface ChannelSlot {
  readonly synth: SpessaSynthProcessor;
  readonly channel: number;
  readonly rejected: readonly DlsKeyRange[];
}

function matchPreset(dls: DlsBank, bankLo: number, bankHi: number, patch: number): BasicPreset | undefined {
  const presets = dls.bank.presets;
  const exact = presets.find((p) => p.program === patch && p.bankMSB === bankHi && p.bankLSB === bankLo);
  if (exact !== undefined) return exact;
  const fallback = presets.find((p) => p.program === patch) ?? presets[0];
  if (fallback !== undefined) {
    console.warn(
      `[pipeline] music: ${dls.file} has no preset ${bankHi}:${bankLo}:${patch}; using "${fallback.name}"`,
    );
  }
  return fallback;
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(MIDI_MAX, Math.round(value)));
}

/** Renders the dump into stereo float channels of exactly `frames` frames at `sampleRate`. */
export async function synthesizeEvents(
  segment: SegmentEvents,
  banks: ReadonlyMap<string, DlsBank>,
  sampleRate: number,
  frames: number,
): Promise<Float32Array[]> {
  const processors: SpessaSynthProcessor[] = [];
  const usedChannels = new Map<SpessaSynthProcessor, number>();
  const perBank = new Map<string, SpessaSynthProcessor[]>();
  const slots = new Map<number, ChannelSlot>();

  for (const inst of segment.instances) {
    const dls = banks.get(inst.dls);
    if (dls === undefined) throw new Error(`no DLS bank named "${inst.dls}"`);
    let pool = perBank.get(inst.dls);
    if (pool === undefined) {
      pool = [];
      perBank.set(inst.dls, pool);
    }
    let synth = pool.find((p) => (usedChannels.get(p) ?? 0) < MIDI_CHANNELS_PER_PROCESSOR);
    if (synth === undefined) {
      synth = new SpessaSynthProcessor(sampleRate, {
        effectsEnabled: false,
        eventsEnabled: false,
        maxBufferSize: SYNTH_QUANTUM,
      });
      synth.soundBankManager.addSoundBank(dls.bank, 'main');
      await synth.processorInitialized;
      pool.push(synth);
      processors.push(synth);
    }
    const channel = usedChannels.get(synth) ?? 0;
    usedChannels.set(synth, channel + 1);

    const preset = matchPreset(dls, inst.bankLo, inst.bankHi, inst.patch);
    if (preset === undefined) throw new Error(`no presets in ${dls.file}`);
    const midiChannel = synth.midiChannels[channel];
    if (midiChannel === undefined) throw new Error(`no MIDI channel ${channel}`);
    midiChannel.setDrums(preset.isGMGSDrum);
    // Bank select and program keep channel state coherent; pinning the preset then overrides the
    // GS bank heuristics, which can pick another candidate for exotic bank pairs.
    synth.controllerChange(channel, CC_BANK_MSB, preset.bankMSB);
    synth.controllerChange(channel, CC_BANK_LSB, preset.bankLSB);
    synth.programChange(channel, preset.program);
    midiChannel.preset = preset;
    // Recover the authored band bytes: volume arrives squared, pan as (bPan - 63) / 64.
    synth.controllerChange(channel, CC_VOLUME, clampMidi(Math.sqrt(inst.vol) * MIDI_MAX));
    synth.controllerChange(channel, CC_PAN, clampMidi(inst.pan * (PAN_CENTER + 1) + PAN_CENTER));
    synth.controllerChange(channel, CC_REVERB_SEND, 0);
    const rejects = dls.rejected.find(
      (r) => r.bankLo === inst.bankLo && r.bankHi === inst.bankHi && r.patch === inst.patch,
    );
    slots.set(inst.id, { synth, channel, rejected: rejects?.ranges ?? [] });
  }

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const quantumL = new Float32Array(SYNTH_QUANTUM);
  const quantumR = new Float32Array(SYNTH_QUANTUM);
  let next = 0;
  for (let frame = 0; frame < frames; frame += SYNTH_QUANTUM) {
    while (next < segment.events.length) {
      const ev = segment.events[next];
      if (ev === undefined || ev.t >= frame + SYNTH_QUANTUM) break;
      next++;
      const slot = slots.get(ev.id);
      if (slot === undefined) continue;
      const { synth, channel, rejected } = slot;
      switch (ev.e) {
        case 'on':
        case 'off': {
          const note = ev.note;
          if (rejected.some((r) => note >= r.lo && note <= r.hi)) break;
          if (ev.e === 'on') synth.noteOn(channel, note, clampMidi(ev.vel));
          else synth.noteOff(channel, note);
          break;
        }
        case 'cc':
          // MIDIController enumerates every 0-127 value, which clampMidi proves.
          synth.controllerChange(channel, clampMidi(ev.cc) as MIDIController, clampMidi(ev.val * MIDI_MAX));
          break;
        case 'pb':
          synth.pitchWheel(channel, Math.max(0, Math.min(PITCH_WHEEL_MAX, Math.round(ev.val))));
          break;
        case 'alloff':
          synth.controllerChange(channel, CC_ALL_NOTES_OFF, 0);
          break;
      }
    }
    const count = Math.min(SYNTH_QUANTUM, frames - frame);
    for (const synth of processors) {
      quantumL.fill(0);
      quantumR.fill(0);
      synth.process(quantumL, quantumR, 0, count);
      for (let i = 0; i < count; i++) {
        left[frame + i] = (left[frame + i] ?? 0) + (quantumL[i] ?? 0);
        right[frame + i] = (right[frame + i] ?? 0) + (quantumR[i] ?? 0);
      }
    }
  }
  return [left, right];
}
