/** The `(hx, hy)` of a sim node id, which numbers the half-cell lattice row by row, `nodeWidth` nodes per
 *  row. */
export function nodeOfId(node: number, nodeWidth: number): { hx: number; hy: number } {
  const hx = node % nodeWidth;
  return { hx, hy: (node - hx) / nodeWidth };
}
