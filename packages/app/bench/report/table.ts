/** Padded fixed-width tables for the stdout reports. A negative width means left-aligned. */

export interface Column {
  readonly header: string;
  readonly width: number;
}

function row(columns: readonly Column[], values: readonly string[]): string {
  return columns
    .map((c, i) => {
      const value = values[i] ?? '';
      return c.width < 0 ? value.padEnd(-c.width) : value.padStart(c.width);
    })
    .join('')
    .trimEnd();
}

/** The header row plus its rule, sized to the summed absolute column widths. */
function header(columns: readonly Column[]): readonly string[] {
  return [
    row(
      columns,
      columns.map((c) => c.header),
    ),
    '-'.repeat(columns.reduce((sum, c) => sum + Math.abs(c.width), 0)),
  ];
}

export function table(columns: readonly Column[], rows: readonly (readonly string[])[]): readonly string[] {
  return [...header(columns), ...rows.map((values) => row(columns, values))];
}
