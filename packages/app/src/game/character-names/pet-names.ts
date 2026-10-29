import { codePointLength, hasControlCharacter, SETTLER_NAME_MAX_CHARS } from '@open-northland/sim';

/**
 * The player's own name for one settler. It is display-only: no sim component carries it, no command
 * writes it, and no other seat sees it, which is what keeps a rename out of lockstep and out of the
 * cross-language session that would push one player's script onto a client that cannot read it. Rename
 * happens here instead of in the sim, so the text rules the `renameSettler` command enforced are
 * enforced again on the way in.
 */

/** Where one playthrough's renames outlive the page, keyed as `playthroughKey` names a game. */
export interface PetNameArchive {
  read(key: string): Promise<ReadonlyMap<number, string>>;
  write(key: string, names: ReadonlyMap<number, string>): Promise<void>;
}

export interface PetNames {
  /** The name the player gave settler `entity`, or undefined when they gave none. */
  get(entity: number): string | undefined;
  /** Name one settler, or take the name back with a blank one. */
  set(entity: number, name: string): void;
  /** Every rename of the running world, for the archive to carry. */
  entries(): ReadonlyMap<number, string>;
}

/** Whether `name` may be stored: trimmed, 1..{@link SETTLER_NAME_MAX_CHARS} code points, no control
 *  characters. */
export function isAcceptedPetName(name: string): boolean {
  return name.length > 0 && codePointLength(name) <= SETTLER_NAME_MAX_CHARS && !hasControlCharacter(name);
}

/** Renames kept in memory alone: a world with nowhere to keep them still shows them while it runs. */
export function memoryPetNames(): PetNames {
  const names = new Map<number, string>();
  return {
    get: (entity) => names.get(entity),
    set: (entity, name) => {
      const trimmed = name.trim();
      if (!isAcceptedPetName(trimmed)) names.delete(entity);
      else names.set(entity, trimmed);
    },
    entries: () => new Map(names),
  };
}

/** One world's renames, read from `archive` and written back to it as they change. */
export function petNamesOf(archive: PetNameArchive, key: string): Promise<PetNames> {
  return archive.read(key).then((stored) => {
    const names = new Map(stored);
    const inner = memoryPetNames();
    for (const [entity, name] of names) inner.set(entity, name);
    // An archive that cannot take the write loses the name with the page, not the rename: the running
    // game keeps showing it, and the diagnostics of the caller that installed the store do the rest.
    const save = (): void => void archive.write(key, inner.entries()).catch(() => undefined);
    return {
      get: inner.get,
      entries: inner.entries,
      set: (entity, name) => {
        inner.set(entity, name);
        save();
      },
    };
  });
}

let installed = memoryPetNames();

/** The running world's renames, which `settlerName` reads; a boot installs the kept ones once. */
export function petNames(): PetNames {
  return installed;
}

export function installPetNames(names: PetNames): void {
  installed = names;
}
