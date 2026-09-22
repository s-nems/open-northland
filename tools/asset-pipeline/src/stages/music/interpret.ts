/**
 * DirectMusic performance interpreter: schedules a segment's tracks as timed messages and runs
 * the render clock to produce the instrument event stream the synthesizer replays.
 */

import { DMUS_PPQ } from '../../decoders/sgt.js';
import {
  type DmBand,
  type DmPattern,
  type DmSequenceItem,
  type DmTimeSignature,
  decodeSegmentTracks,
} from '../../decoders/sgt-tracks.js';
import type { EventInstance, SegmentEvents, TimedEvent } from './events.js';
import {
  curveValue,
  DEFAULT_PERFORMANCE_CHORD,
  DMUS_CURVET_CCCURVE,
  DMUS_CURVET_PBCURVE,
  musicValueToMidi,
} from './music-value.js';
import { LibcxxPriorityQueue } from './priority-queue.js';

/** Ticks between successive interpolated curve messages. */
const CURVE_SPACING = 5;
const PERCUSSION_CHANNEL = 9;
const PERCUSSION_CHANNEL_PERIOD = 16;
const MIDI_NOTE_ON_STATUS = 0x90;
/** PlayingContext construction defaults. */
const INITIAL_TEMPO_BPM = 100;
const U16 = 0xffff;

const f32 = Math.fround;

type Message =
  | { readonly kind: 'tempo'; readonly time: number; readonly tempo: number }
  | {
      readonly kind: 'band';
      readonly time: number;
      /** pChannel to instance id; undefined marks a GM-preset instrument that plays silently. */
      readonly assignments: ReadonlyMap<number, number | undefined>;
    }
  | { readonly kind: 'chord'; readonly time: number }
  | {
      readonly kind: 'noteOn';
      readonly time: number;
      readonly note: number;
      readonly velocity: number;
      readonly channel: number;
      readonly channelAlt: number;
    }
  | {
      readonly kind: 'noteOff';
      readonly time: number;
      readonly note: number;
      readonly channel: number;
      readonly channelAlt: number;
    }
  | {
      readonly kind: 'cc';
      readonly time: number;
      readonly control: number;
      readonly value: number;
      readonly channel: number;
      readonly channelAlt: number;
    }
  | {
      readonly kind: 'pb';
      readonly time: number;
      readonly value: number;
      readonly channel: number;
      readonly channelAlt: number;
    }
  | { readonly kind: 'segmentEnd'; readonly time: number };

type NoteOff = Extract<Message, { kind: 'noteOff' }>;

/** Band setup precedes chords, which precede notes carrying the same timestamp. */
function priority(message: Message): number {
  if (message.kind === 'band') return 2;
  if (message.kind === 'chord') return 1;
  return 0;
}

/** Heap order: earliest time first; on ties the higher priority pops first. */
function messageLess(a: Message, b: Message): boolean {
  return a.time === b.time ? priority(a) < priority(b) : a.time > b.time;
}

interface PreparedSegment {
  readonly initialTempo: number;
  /** Schedule-time messages with segment-relative times, in construction order. */
  readonly messages: readonly Message[];
  readonly instances: readonly EventInstance[];
}

function foldPercussionChannel(pChannel: number): number {
  if (pChannel >= PERCUSSION_CHANNEL && (pChannel - PERCUSSION_CHANNEL) % PERCUSSION_CHANNEL_PERIOD === 0) {
    return PERCUSSION_CHANNEL;
  }
  return pChannel;
}

function measureTicks(timeSig: DmTimeSignature): number {
  return Math.floor((timeSig.beatsPerMeasure * DMUS_PPQ * 4) / timeSig.beat);
}

function musicOffset(gridStart: number, timeOffset: number, timeSig: DmTimeSignature): number {
  const beatTicks = Math.floor((DMUS_PPQ * 4) / timeSig.beat);
  return (
    timeOffset +
    Math.floor(gridStart / timeSig.gridsPerBeat) * beatTicks +
    (gridStart % timeSig.gridsPerBeat) * Math.floor(beatTicks / timeSig.gridsPerBeat)
  );
}

/** Repeat r plays the r-th authored variation, wrapping around. */
function pickSequentialVariation(choices: readonly number[], repeat: number): number {
  const available: number[] = [];
  for (const [i, choice] of choices.entries()) {
    if ((choice & 0x0fffffff) !== 0) available.push(i);
  }
  if (available.length === 0) return 0;
  return available[repeat % available.length] ?? 0;
}

/** Every pattern track plays its embedded pattern simultaneously, looping to the segment length. */
function scheduleDx8Pattern(pattern: DmPattern, segmentLength: number, messages: Message[]): void {
  const patternLength = pattern.measures * measureTicks(pattern.timeSig);
  if (patternLength === 0) return;
  for (const ref of pattern.partRefs) {
    const part = pattern.parts.get(ref.partId);
    if (part === undefined) throw new Error(`pattern part ${ref.partId} not found`);
    const pChannel = foldPercussionChannel(ref.logicalPartId);
    let repeat = 0;
    for (let start = 0; start < segmentLength; start += patternLength, repeat++) {
      const variation = (1 << pickSequentialVariation(part.variationChoices, repeat)) >>> 0;

      for (const note of part.notes) {
        if ((note.variation & variation) === 0) continue;
        const time = start + musicOffset(note.gridStart, note.timeOffset, part.timeSig);
        if (time < 0 || time >= segmentLength) continue;
        const key = musicValueToMidi(
          DEFAULT_PERFORMANCE_CHORD,
          undefined,
          note.musicValue,
          note.playMode,
          part.playMode,
        );
        if (key === undefined) continue;
        const channel = ref.logicalPartId;
        messages.push({
          kind: 'noteOn',
          time: time >>> 0,
          note: key,
          velocity: note.velocity,
          channel,
          channelAlt: pChannel,
        });
        messages.push({
          kind: 'noteOff',
          time: (time + note.duration) >>> 0,
          note: key,
          channel,
          channelAlt: pChannel,
        });
      }

      for (const curve of part.curves) {
        if ((curve.variation & variation) === 0) continue;
        const isPitchBend = curve.eventType === DMUS_CURVET_PBCURVE;
        if (!isPitchBend && curve.eventType !== DMUS_CURVET_CCCURVE) continue;
        if (!isPitchBend && (curve.startValue > 127 || curve.endValue > 127)) continue;
        const timeStart = start + musicOffset(curve.gridStart, curve.timeOffset, part.timeSig);
        // Pitch bend curves carry the raw 0-16383 wheel range (8192 center); CC curves 0-127.
        const startValue = isPitchBend ? f32(curve.startValue) : f32(curve.startValue / 127);
        const endValue = isPitchBend ? f32(curve.endValue) : f32(curve.endValue / 127);
        const steps = Math.floor(curve.duration / CURVE_SPACING);
        for (let i = 0; i < steps; i++) {
          const offset = i * CURVE_SPACING;
          const time = timeStart + offset;
          if (time < 0 || time >= segmentLength) continue;
          const phase = f32(f32(offset) / f32(curve.duration));
          const value = curveValue(curve.shape, phase, startValue, endValue);
          const channel = ref.logicalPartId;
          if (isPitchBend) {
            messages.push({
              kind: 'pb',
              time: time >>> 0,
              value: Math.trunc(value) & U16,
              channel,
              channelAlt: pChannel,
            });
          } else {
            messages.push({
              kind: 'cc',
              time: time >>> 0,
              control: curve.ccData,
              value,
              channel,
              channelAlt: pChannel,
            });
          }
        }
      }
    }
  }
}

function scheduleSequence(items: readonly DmSequenceItem[], messages: Message[]): void {
  for (const item of items) {
    if ((item.status & 0xf0) !== MIDI_NOTE_ON_STATUS) continue;
    let time = item.time + item.offset;
    if (time < 0) time = 0;
    const pChannel = foldPercussionChannel(item.pChannel);
    messages.push({
      kind: 'noteOn',
      time: time >>> 0,
      note: item.byte1,
      velocity: item.byte2,
      channel: item.pChannel,
      channelAlt: pChannel,
    });
    messages.push({
      kind: 'noteOff',
      time: (time + item.duration) >>> 0,
      note: item.byte1,
      channel: item.pChannel,
      channelAlt: pChannel,
    });
  }
}

interface InstanceCounter {
  next: number;
}

/** Creates the band's instances (identity rows in creation order) and its assignment message. */
function bandChange(
  time: number,
  band: DmBand,
  instances: EventInstance[],
  counter: InstanceCounter,
): Message {
  const assignments = new Map<number, number | undefined>();
  for (const inst of band.instruments) {
    const bankHi = (inst.patch & 0x00ff0000) >>> 16;
    const bankLo = (inst.patch & 0x0000ff00) >>> 8;
    const patch = inst.patch & 0xff;
    if (inst.file === undefined) {
      assignments.set(inst.pChannel, undefined);
      continue;
    }
    const id = ++counter.next;
    instances.push({
      id,
      dls: inst.file,
      bankLo,
      bankHi,
      patch,
      // The authored band bytes as the players receive them: volume squared, pan centered on 63.
      // Both are single-precision in the reference player.
      vol: f32((inst.volume * inst.volume) / (127 * 127)),
      pan: f32((inst.pan - 63) / 64),
      transpose: inst.transpose,
    });
    assignments.set(inst.pChannel, id);
  }
  return { kind: 'band', time, assignments };
}

function prepareSegment(bytes: Uint8Array): PreparedSegment & { readonly length: number } {
  const segment = decodeSegmentTracks(bytes);
  const messages: Message[] = [];
  const instances: EventInstance[] = [];
  const counter: InstanceCounter = { next: 0 };
  let initialTempo = 0;

  messages.push({ kind: 'segmentEnd', time: segment.length });
  for (const track of segment.tracks) {
    switch (track.kind) {
      case 'tempo':
        for (const item of track.items) {
          messages.push({ kind: 'tempo', time: Math.max(0, item.time), tempo: item.bpm });
        }
        break;
      case 'pattern':
        if (track.pattern !== undefined) {
          scheduleDx8Pattern(track.pattern, segment.length, messages);
          if (track.pattern.band !== undefined) {
            messages.push(bandChange(0, track.pattern.band, instances, counter));
          }
          initialTempo = track.tempo;
        }
        break;
      case 'sequence':
        scheduleSequence(track.items, messages);
        break;
      case 'band':
        for (const change of track.changes) {
          // lBandTimePhysical is signed in the player; the corpus authors -1, clamped to zero.
          messages.push(bandChange(Math.max(0, change.time | 0), change.band, instances, counter));
        }
        break;
      case 'chord':
        for (const time of track.times) {
          messages.push({ kind: 'chord', time });
        }
        break;
    }
  }
  return { length: segment.length, initialTempo, messages, instances };
}

export interface InterpretOptions {
  readonly sampleRate: number;
  readonly audioChannels: number;
  /** Whole seconds to render, as the render loop counts them. */
  readonly renderSeconds: number;
}

interface PerformanceState {
  /** Music time in ticks (uint32). */
  musicTime: number;
  tempo: number;
  /** Frame clock the emitted events are stamped with. */
  frames: number;
  /** Performance channel to instance id; undefined marks a silent GM-preset player. */
  readonly channels: Map<number, number | undefined>;
  queue: LibcxxPriorityQueue<Message>;
  /** Note-offs carried over a pass boundary, earliest first. They stay out of the queue so the pass's
   *  own tie order is untouched; a release due no later than the queue's head executes first. */
  readonly carried: NoteOff[];
  readonly events: TimedEvent[];
  readonly segmentEndFrames: number[];
}

/**
 * Rebuilds the queue for one segment pass: initial tempo first, then every prepared message. The
 * releases of notes still sounding are carried over: DirectMusic ties a note's off to the note
 * itself, so a note struck near a pass end rings out under the next pass. The reference player
 * drops the whole pending queue instead, which leaves such notes sounding for the rest of the render.
 */
function enqueueSegment(state: PerformanceState, prepared: PreparedSegment): void {
  carryPendingReleases(state);
  state.queue = new LibcxxPriorityQueue(messageLess);
  state.queue.push({ kind: 'tempo', time: state.musicTime, tempo: prepared.initialTempo });
  for (const message of prepared.messages) {
    state.queue.push({ ...message, time: (message.time + state.musicTime) >>> 0 });
  }
}

/** Empties the queue into {@link PerformanceState.carried}, keeping only the note-offs; their times
 *  are already absolute. */
function carryPendingReleases(state: PerformanceState): void {
  for (let next = state.queue.top(); next !== undefined; next = state.queue.top()) {
    state.queue.pop();
    if (next.kind === 'noteOff') state.carried.push(next);
  }
  state.carried.sort((a, b) => a.time - b.time);
}

function execute(state: PerformanceState, prepared: PreparedSegment, message: Message): void {
  switch (message.kind) {
    case 'tempo':
      state.tempo = message.tempo;
      break;
    case 'band':
      for (const [pChannel, id] of message.assignments) state.channels.set(pChannel, id);
      break;
    case 'chord':
      // Contributes only its queue-boundary timing (why: the sgt-tracks chord decoder).
      break;
    case 'segmentEnd':
      state.segmentEndFrames.push(state.frames);
      enqueueSegment(state, prepared);
      break;
    default:
      executeChannelMessage(state, message);
  }
}

function executeChannelMessage(
  state: PerformanceState,
  message: Extract<Message, { channel: number }>,
): void {
  let id: number | undefined;
  if (state.channels.has(message.channel)) {
    id = state.channels.get(message.channel);
  } else if (state.channels.has(message.channelAlt)) {
    id = state.channels.get(message.channelAlt);
  } else {
    return;
  }
  if (id === undefined) return;
  const t = state.frames;
  switch (message.kind) {
    case 'noteOn':
      state.events.push({ e: 'on', t, id, note: message.note, vel: message.velocity });
      break;
    case 'noteOff':
      state.events.push({ e: 'off', t, id, note: message.note });
      break;
    case 'cc':
      state.events.push({ e: 'cc', t, id, cc: message.control, val: message.value });
      break;
    case 'pb':
      state.events.push({ e: 'pb', t, id, val: message.value });
      break;
  }
}

/**
 * One render call over `count` interleaved samples: pop due messages, advancing the music clock
 * with the reference renderer's exact double arithmetic and uint32 truncations. The frame clock
 * only advances while at least one performance channel exists, mirroring the per-player block
 * rendering it replaces.
 */
function renderAudio(
  state: PerformanceState,
  prepared: PreparedSegment,
  count: number,
  sampleRate: number,
  audioChannels: number,
): void {
  let pulsesPerSample = (DMUS_PPQ * (state.tempo / 60)) / (sampleRate * audioChannels);
  let offset = 0;
  while (offset < count) {
    const head = state.queue.top();
    if (head === undefined) break;
    const release = state.carried[0];
    const next = release !== undefined && release.time <= head.time ? release : head;
    pulsesPerSample = (DMUS_PPQ * (state.tempo / 60)) / (sampleRate * audioChannels);
    let ticks = next.time < state.musicTime ? 0 : next.time - state.musicTime;
    // Advancing time at a non-positive tempo would pop every later message at zero samples and
    // loop forever (the enqueued default tempo is transiently zero until a tempo item executes in
    // the same tie group); failing the render beats an in-process hang.
    if (ticks > 0 && !(state.tempo > 0)) throw new Error(`non-positive tempo ${state.tempo}`);
    let samples = Math.trunc(ticks / pulsesPerSample) >>> 0;
    if (samples % audioChannels !== 0) {
      samples = (samples + 1) >>> 0;
      ticks = Math.trunc(samples * pulsesPerSample) >>> 0;
    }
    if (samples + offset > count) break;
    if (state.channels.size > 0) state.frames += Math.floor(samples / audioChannels);
    offset += samples;
    state.musicTime = (state.musicTime + ticks) >>> 0;
    if (next === release) {
      state.carried.shift();
      executeChannelMessage(state, release);
    } else {
      state.queue.pop();
      execute(state, prepared, next);
    }
  }
  const remaining = count - offset;
  if (remaining > 0) {
    if (state.channels.size > 0) state.frames += Math.floor(remaining / audioChannels);
    state.musicTime = Math.trunc(state.musicTime + remaining * pulsesPerSample) >>> 0;
  }
}

/** Interprets a segment into the event stream the synthesizer replays. */
export function interpretSegment(bytes: Uint8Array, options: InterpretOptions): SegmentEvents {
  const prepared = prepareSegment(bytes);
  const state: PerformanceState = {
    musicTime: 0,
    tempo: INITIAL_TEMPO_BPM,
    frames: 0,
    channels: new Map(),
    queue: new LibcxxPriorityQueue(messageLess),
    carried: [],
    events: [],
    segmentEndFrames: [],
  };
  enqueueSegment(state, prepared);
  // The reference loop renders one sampleRate-sized block of interleaved samples per iteration.
  const blocks = options.renderSeconds * options.audioChannels;
  for (let block = 0; block < blocks; block++) {
    renderAudio(state, prepared, options.sampleRate, options.sampleRate, options.audioChannels);
  }
  return { instances: prepared.instances, events: state.events, segmentEndFrames: state.segmentEndFrames };
}
