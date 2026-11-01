/** How many rows a sidebar section shows at first, and how many more each Show more adds. */
export const SIDEBAR_ROWS = 10;

/**
 * The first `shown` rows, and the one the main area has open if it lies beyond them: a screen's own
 * row never hides.
 */
export function shownRows<Row>(
  rows: ReadonlyArray<Row>,
  shown: number,
  isOpen: (row: Row) => boolean,
): { readonly rows: ReadonlyArray<Row>; readonly hidden: number } {
  const first = rows.slice(0, shown);
  const open = rows.slice(shown).find(isOpen);
  const visible = open === undefined ? first : [...first, open];
  return { rows: visible, hidden: rows.length - visible.length };
}
