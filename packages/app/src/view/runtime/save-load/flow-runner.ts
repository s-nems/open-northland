/** One in-flight flow per panel: a second click while a dialog or store call is pending would
 *  stack another one. A flow resolves to the status line to show, or null to leave it cleared. */
export function flowRunner(
  setStatus: (text: string | null) => void,
): (flow: () => Promise<string | null>) => void {
  let busy = false;
  return (flow) => {
    if (busy) return;
    busy = true;
    setStatus(null);
    void flow()
      .then(setStatus)
      .finally(() => {
        busy = false;
      });
  };
}
