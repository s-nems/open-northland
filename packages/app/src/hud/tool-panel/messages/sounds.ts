import type { AttackFront, NoticeVoice, SoundDriver } from '@open-northland/audio';
import type { ShownNote } from './feed.js';
import { FIGHT_TYPE } from './fight-areas.js';
import { USER_MESSAGE_TYPE, type UserMessageType } from './types.js';

/**
 * What a shown notice sounds. Authored throughout: the original rings no sound for a message card.
 * An attack note feeds the attack alert on every hit, which decides by the camera whether the horn
 * sounds; any other note sounds only as a new card. A settler's weariness or hunger speaks in its own
 * voice, and one about to starve gasps, a cue of its own that outranks the hungry sighs; a note whose
 * event already rings its own sound (a finished building, a discovery) adds none; every other card rings
 * the card cue.
 */
export type NoticeSound =
  | { readonly kind: 'attack'; readonly front: AttackFront }
  | { readonly kind: 'voice'; readonly voice: NoticeVoice }
  | { readonly kind: 'own' }
  | { readonly kind: 'card' };

const CARD: NoticeSound = { kind: 'card' };
const OWN: NoticeSound = { kind: 'own' };
const WEARY: NoticeSound = { kind: 'voice', voice: 'weary' };
const HUNGRY: NoticeSound = { kind: 'voice', voice: 'hungry' };
const DYING: NoticeSound = { kind: 'voice', voice: 'dying' };

const NOTICE_SOUNDS: ReadonlyMap<UserMessageType, NoticeSound> = new Map<UserMessageType, NoticeSound>([
  [FIGHT_TYPE.settlement, { kind: 'attack', front: 'base' }],
  [FIGHT_TYPE.field, { kind: 'attack', front: 'units' }],
  [USER_MESSAGE_TYPE.nothingToDo, WEARY],
  [USER_MESSAGE_TYPE.tired, WEARY],
  [USER_MESSAGE_TYPE.hungry, HUNGRY],
  [USER_MESSAGE_TYPE.starving, HUNGRY],
  [USER_MESSAGE_TYPE.willDie, DYING],
  // The house-built jingle rings for these, quieter from off screen, and the technology jingle for the
  // unlocks.
  [USER_MESSAGE_TYPE.houseFinished, OWN],
  [USER_MESSAGE_TYPE.experienceUnlocks, OWN],
  [USER_MESSAGE_TYPE.canProduceNewGood, OWN],
  [USER_MESSAGE_TYPE.canDoNewJob, OWN],
]);

export function noticeSoundOf(type: UserMessageType): NoticeSound {
  return NOTICE_SOUNDS.get(type) ?? CARD;
}

/** The driver calls a shown note makes. */
export type NoticeSoundSink = Pick<SoundDriver, 'alertAttack' | 'noticeVoice' | 'notify'>;

/** Sound one shown note through `sink`. */
export function soundShownNote(note: ShownNote, sink: NoticeSoundSink): void {
  const { pending, fresh } = note;
  const sound = noticeSoundOf(pending.type);
  switch (sound.kind) {
    case 'attack':
      if (pending.at !== null) sink.alertAttack({ front: sound.front, at: pending.at });
      return;
    case 'voice':
      if (fresh && pending.subject?.kind === 'settler') sink.noticeVoice(sound.voice, pending.subject.entity);
      return;
    case 'own':
      return;
    case 'card':
      // One card ring per message type per notice interval: a busy settlement raises one type in a row.
      if (fresh) sink.notify('card', String(pending.type));
      return;
  }
}
