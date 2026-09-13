import type { OpenedWorld } from './relay-client.js';

/** Only the latest world operation may publish a result or a failure. */
export class WorldLoader {
  private revision = 0;
  busy = false;

  invalidate(): void {
    this.revision++;
    this.busy = false;
  }

  async run(
    open: () => Promise<OpenedWorld | null>,
    adopt: (world: OpenedWorld | null) => void,
  ): Promise<void> {
    const revision = ++this.revision;
    this.busy = true;
    try {
      const world = await open();
      if (revision !== this.revision) return;
      this.busy = false;
      adopt(world);
    } catch (error) {
      if (revision === this.revision) throw error;
    } finally {
      if (revision === this.revision) this.busy = false;
    }
  }
}
