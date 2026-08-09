/**
 * DirectMusic performance interpreter: schedules a segment's tracks as timed messages and runs
 * the render clock to produce the instrument event stream the synthesizer replays. Behavioral
 * port of the MIT libdmusic player this pipeline previously vendored (with the project patch);
 * message vector order, priority-queue tie behavior (libc++ heap), and the uint32/double clock
 * arithmetic are reproduced exactly, proven by event parity against its dumps over the owned
 * corpus.
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

/**
 * Priority queue reproducing libc++'s `std::priority_queue` element order exactly, including the
 * pop order of tie groups: push is a plain sift-up, pop is Floyd's sift-down (walk the hole to a
 * leaf along the larger children) followed by a sift-up fixup of the relocated tail element.
 */
export class LibcxxPriorityQueue<T> {
  private readonly heap: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.heap.length;
  }

  top(): T | undefined {
    return this.heap[0];
  }

  push(value: T): void {
    this.heap.push(value);
    this.siftUp(this.heap.length);
  }

  pop(): void {
    const h = this.heap;
    const len = h.length;
    if (len > 1) {
      const top = h[0] as T;
      let hole = 0;
      let childI = 0;
      let child = 0;
      for (;;) {
        childI += child + 1;
        child = 2 * child + 1;
        if (child + 1 < len && this.less(h[childI] as T, h[childI + 1] as T)) {
          childI++;
          child++;
        }
        h[hole] = h[childI] as T;
        hole = childI;
        if (child > Math.floor((len - 2) / 2)) break;
      }
      const last = len - 1;
      if (hole === last) {
        h[hole] = top;
      } else {
        h[hole] = h[last] as T;
        h[last] = top;
        this.siftUp(hole + 1);
      }
    }
    h.pop();
  }

  /** Bubbles the element at slot `len - 1` toward the root within the first `len` slots. */
  private siftUp(len: number): void {
    const h = this.heap;
    if (len <= 1) return;
    let parent = Math.floor((len - 2) / 2);
    let hole = len - 1;
    if (!this.less(h[parent] as T, h[hole] as T)) return;
    const value = h[hole] as T;
    for (;;) {
      h[hole] = h[parent] as T;
      hole = parent;
      if (parent === 0) break;
      parent = Math.floor((parent - 1) / 2);
      if (!this.less(h[parent] as T, value)) break;
    }
    h[hole] = value;
  }
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
          // The validated renders come from a player that read each tempo item's time out of the
          // record's padding dword, which this corpus always authors as zero: every tempo change
          // applies at time zero, and the last one to pop wins.
          messages.push({ kind: 'tempo', time: 0, tempo: item.bpm });
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
  readonly events: TimedEvent[];
}

/** Rebuilds the queue for one segment pass: initial tempo first, then every prepared message. */
function enqueueSegment(state: PerformanceState, prepared: PreparedSegment): void {
  state.queue = new LibcxxPriorityQueue(messageLess);
  state.queue.push({ kind: 'tempo', time: state.musicTime, tempo: prepared.initialTempo });
  for (const message of prepared.messages) {
    state.queue.push({ ...message, time: (message.time + state.musicTime) >>> 0 });
  }
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
      // Chord state is only read when notes resolve at run time; the DX8 path resolves them at
      // schedule time, so the message only contributes its queue-boundary timing.
      break;
    case 'segmentEnd':
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
  let pulsesPerSample = (DMUS_PPQ * (state.tempo / 60)) / sampleRate;
  let offset = 0;
  while (offset < count) {
    const next = state.queue.top();
    if (next === undefined) break;
    pulsesPerSample = (DMUS_PPQ * (state.tempo / 60)) / (sampleRate * audioChannels);
    let ticks = next.time < state.musicTime ? 0 : next.time - state.musicTime;
    let samples = Math.trunc(ticks / pulsesPerSample) >>> 0;
    if (samples % audioChannels !== 0) {
      samples = (samples + 1) >>> 0;
      ticks = Math.trunc(samples * pulsesPerSample) >>> 0;
    }
    if (samples + offset > count) break;
    if (state.channels.size > 0) state.frames += Math.floor(samples / audioChannels);
    offset += samples;
    state.musicTime = (state.musicTime + ticks) >>> 0;
    state.queue.pop();
    execute(state, prepared, next);
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
    events: [],
  };
  enqueueSegment(state, prepared);
  // The reference loop renders one sampleRate-sized block of interleaved samples per iteration.
  const blocks = options.renderSeconds * options.audioChannels;
  for (let block = 0; block < blocks; block++) {
    renderAudio(state, prepared, options.sampleRate, options.sampleRate, options.audioChannels);
  }
  return { instances: prepared.instances, events: state.events };
}
