/** A missing id is an HTML/script mismatch, not a state the page can render. */
export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`setup page is missing #${id}`);
  return found as T;
}
