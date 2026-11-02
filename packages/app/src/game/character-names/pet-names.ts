import { codePointLength, hasControlCharacter } from '@open-northland/sim';

/**
 * The player's own names for their settlers. They are display-only and stay on this client: no sim
 * component carries them and no command sends them, so one seat's rename never reaches another seat's
 * screen. A save keeps them in its presentation memory beside the world they were given in.
 */

/** The longest name the player may give, in code points. */
export const SETTLER_NAME_MAX_CHARS = 24;

/**
 * The settler a name belongs to: its entity id and the generated name it carried. An entity id alone
 * is not enough, since a load rewinds the id counter and a later settler may take the same id.
 */
export interface NamedSettler {
  readonly entity: number;
  readonly pool: string;
  readonly raw: string;
}

/** One name the player gave, as a save's presentation memory keeps it. */
export interface PetNameRecord extends NamedSettler {
  readonly name: string;
}

export type PetNameChange = 'named' | 'cleared' | 'refused';

export interface PetNames {
  /** The name the player gave `settler`, or undefined when they gave none. */
  get(settler: NamedSettler): string | undefined;
  /** Name `settler`. A blank name takes the name back; one the rules refuse leaves the old name. */
  set(settler: NamedSettler, name: string): PetNameChange;
  /** Every name the player gave, for the save to keep. */
  records(): readonly PetNameRecord[];
}

/** Whether a trimmed `name` may be given: 1..{@link SETTLER_NAME_MAX_CHARS} code points and no
 *  control characters. */
export function isAcceptedPetName(name: string): boolean {
  return name.length > 0 && codePointLength(name) <= SETTLER_NAME_MAX_CHARS && !hasControlCharacter(name);
}

/** One world's names, starting from what its save kept. A kept record that breaks the name rules is
 *  dropped, as is all but the last record of one entity. */
export function petNamesOf(kept: readonly PetNameRecord[] = []): PetNames {
  const byEntity = new Map<number, PetNameRecord>();
  for (const record of kept) {
    if (isAcceptedPetName(record.name)) byEntity.set(record.entity, record);
  }
  return {
    get(settler) {
      const record = byEntity.get(settler.entity);
      return record !== undefined && record.pool === settler.pool && record.raw === settler.raw
        ? record.name
        : undefined;
    },
    set(settler, name) {
      const trimmed = name.trim();
      if (trimmed === '') {
        byEntity.delete(settler.entity);
        return 'cleared';
      }
      if (!isAcceptedPetName(trimmed)) return 'refused';
      byEntity.set(settler.entity, { ...settler, name: trimmed });
      return 'named';
    },
    records: () => [...byEntity.values()],
  };
}

let installed = petNamesOf();

/** The running world's names, which `settlerName` reads. */
export function petNames(): PetNames {
  return installed;
}

/** Start a world with `names`; every world installs its own, so no name outlives the world it was
 *  given in. */
export function installPetNames(names: PetNames): void {
  installed = names;
}
