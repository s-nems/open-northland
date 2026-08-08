import { type Component, type DeepReadonly, defineComponent, type Entity, type World } from './world.js';

/**
 * A world-scope singleton component: at most one entity carries it, created on the first {@link write}.
 * While no carrier exists every field reads its default, so a command stream that never writes leaves the
 * world's entity set and hash untouched. The lowest-id carrier wins, keeping hashed state deterministic
 * should a handler ever leave more than one.
 */
export interface WorldSingleton<T extends object> {
  readonly component: Component<T>;
  read(world: World): DeepReadonly<T>;
  write(world: World, apply: (value: T) => void): void;
}

export function defineWorldSingleton<T extends object>(name: string, defaults: () => T): WorldSingleton<T> {
  const component = defineComponent<T>(name);
  // One instance answers every carrier-less read, so the default path allocates nothing. Every World in
  // the process shares it, so a write defeating the read-only view corrupts all of them at once.
  const absent = Object.freeze(defaults()) as DeepReadonly<T>;
  const carrier = (world: World): Entity | null => world.lowestEntityWith(component);
  return {
    component,
    read(world) {
      const e = carrier(world);
      return e === null ? absent : world.get(e, component);
    },
    write(world, apply) {
      const e = carrier(world);
      if (e !== null) {
        apply(world.mut(e, component));
        return;
      }
      const created = defaults();
      apply(created);
      world.add(world.create(), component, created);
    },
  };
}
