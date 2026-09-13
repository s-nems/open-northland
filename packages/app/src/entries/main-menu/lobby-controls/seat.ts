interface SeatRowOptions {
  readonly className: string;
  readonly labelClass?: string;
  readonly nameClass?: string;
  readonly detailClass?: string;
  readonly beforeLabel?: readonly HTMLElement[];
  readonly controls: readonly HTMLElement[];
  readonly action?: HTMLElement;
}

export function seatRow(options: SeatRowOptions) {
  const root = document.createElement('div');
  root.className = options.className;
  const label = document.createElement('div');
  label.className = options.labelClass ?? '';
  const name = document.createElement('span');
  name.className = options.nameClass ?? '';
  const detail = document.createElement('span');
  detail.className = options.detailClass ?? '';
  label.append(name, detail);
  if (options.action) label.append(options.action);
  root.append(...(options.beforeLabel ?? []), label, ...options.controls);
  return {
    root,
    update(title: string, description: string, yours: boolean): void {
      name.textContent = title;
      detail.textContent = description;
      root.classList.toggle('is-yours', yours);
    },
  };
}
