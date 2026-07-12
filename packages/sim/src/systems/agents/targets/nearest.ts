/** Compare nearest-target candidates by distance, then canonical interaction-cell id. */
export function closer(dist: number, cell: number, bestDist: number, bestCell: number): boolean {
  return dist < bestDist || (dist === bestDist && cell < bestCell);
}
