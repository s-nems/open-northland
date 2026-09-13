export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

export function selectControl(
  label: string,
  choices: readonly (readonly [string, string])[],
  change: (value: string) => void,
  className = '',
) {
  const root = node('label', '', className);
  const input = node('select');
  input.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const option = node('option', text);
    option.value = value;
    input.append(option);
  }
  root.append(node('span', label), input);
  let current = '';
  input.addEventListener('change', () => {
    const next = input.value;
    input.value = current;
    change(next);
  });
  return {
    root,
    input,
    update(value: string, disabled: boolean): void {
      current = value;
      // Custom protocol values remain readable even when the menu offers only the usual choices.
      if (![...input.options].some((option) => option.value === value)) {
        const option = node('option', value);
        option.value = value;
        input.append(option);
      }
      input.value = value;
      input.disabled = disabled;
    },
  };
}
