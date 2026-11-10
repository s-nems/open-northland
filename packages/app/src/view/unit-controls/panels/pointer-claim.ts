/** Whether the HUD takes the pointer at a client point. */
export type PointerClaim = (clientX: number, clientY: number) => boolean;

/**
 * `claim` asked once per point within one task. A frame asks for the same pointer from the order aim,
 * the cursor, the action hint and the world hover, and every ask is a hit test that first brings the
 * page's style and layout up to date. The answer is dropped when the task ends, so a click, which is a
 * task of its own, always reads the page as it stands.
 */
export function claimOncePerTask(claim: PointerClaim): PointerClaim {
  let held = false;
  let heldX = 0;
  let heldY = 0;
  let answer = false;
  const forget = (): void => {
    held = false;
  };
  return (clientX, clientY) => {
    if (held && clientX === heldX && clientY === heldY) return answer;
    if (!held) queueMicrotask(forget);
    held = true;
    heldX = clientX;
    heldY = clientY;
    answer = claim(clientX, clientY);
    return answer;
  };
}
