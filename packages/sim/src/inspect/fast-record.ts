/** The most fields a record built by computed-key stores (`record[name] = value`) is sure to keep in
 *  V8's fast layout: past about twenty such additions it turns into a hash table, which an
 *  `Object.assign` copy keeps, at about a hundred times the cost of copying a fast record. */
const KEYED_FIELDS = 16;

/** Add `name` to a record holding `fields` fields and not `name`. Past {@link KEYED_FIELDS} the field is
 *  defined, which V8 adds as a named store, under a limit of over a hundred fields: slower than a keyed
 *  store, but the record keeps its fast layout. */
export function addField(
  record: Record<string, unknown>,
  fields: number,
  name: string,
  value: unknown,
): void {
  if (fields < KEYED_FIELDS) record[name] = value;
  else Object.defineProperty(record, name, { value, writable: true, enumerable: true, configurable: true });
}
