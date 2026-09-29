/**
 * Opts a game text field out of browser and password-manager assistance: autofill, suggestions,
 * spelling marks. macOS AutoFill (codes from Messages) ignores these attributes, so a window must
 * also not focus a text field on its own.
 */
export function quietTextField(input: HTMLInputElement): HTMLInputElement {
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('data-form-type', 'other');
  input.setAttribute('data-1p-ignore', '');
  input.setAttribute('data-lpignore', 'true');
  input.setAttribute('data-bwignore', '');
  return input;
}
