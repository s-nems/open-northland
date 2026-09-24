import { type LobbySettings, type RoomView, sameLobbySettings } from '@open-northland/net-protocol';

export type SettingsPatch = Partial<Omit<LobbySettings, 'rules' | 'kickedSeatMode'>> & {
  readonly rules?: Partial<LobbySettings['rules']>;
  readonly kickedSeatMode?: 'ai' | 'idle' | null;
};

function mergePatch(before: SettingsPatch, next: SettingsPatch): SettingsPatch {
  return {
    ...before,
    ...next,
    ...(before.rules || next.rules ? { rules: { ...before.rules, ...next.rules } } : {}),
  };
}
function applyPatch(settings: LobbySettings, patch: SettingsPatch): LobbySettings {
  const { kickedSeatMode, rules, ...rest } = patch;
  const { kickedSeatMode: previousMode, ...base } = settings;
  const mode = kickedSeatMode === undefined ? previousMode : kickedSeatMode;
  return {
    ...base,
    ...rest,
    rules: { ...settings.rules, ...rules },
    ...(mode == null ? {} : { kickedSeatMode: mode }),
  };
}
export function roomSettingsQueue(send: (settings: LobbySettings) => void) {
  let disposed = false;
  let roomId: string | null = null;
  let editable = false;
  let base: LobbySettings | null = null;
  let flight: LobbySettings | null = null;
  let queued: SettingsPatch | null = null;
  function clear(): void {
    flight = null;
    queued = null;
  }
  function drain(): void {
    if (!editable || base === null || flight !== null || queued === null) return;
    const next = applyPatch(base, queued);
    queued = null;
    // A no-op produces no server RoomView, so it cannot occupy the acknowledgement slot.
    if (sameLobbySettings(base, next)) return;
    flight = next;
    send(next);
  }
  return {
    update(room: RoomView, canEdit: boolean): void {
      if (disposed) return;
      if (room.id !== roomId || !canEdit || room.state !== 'lobby') clear();
      roomId = room.id;
      editable = canEdit && room.state === 'lobby';
      const { world: _world, initialSave: _save, mapOrigin: _origin, ...settings } = room.settings;
      base = settings;
      if (flight !== null && sameLobbySettings(settings, flight)) flight = null;
      drain();
    },
    change(patch: SettingsPatch): void {
      if (!editable) return;
      queued = mergePatch(queued ?? {}, patch);
      drain();
    },
    rejected: clear,
    dispose(): void {
      disposed = true;
      clear();
      editable = false;
      base = null;
      roomId = null;
    },
  };
}
