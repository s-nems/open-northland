/** Resolve a required element of the setup page; a missing id is an HTML/script mismatch, not a state. */
export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`setup page is missing #${id}`);
  return found as T;
}
