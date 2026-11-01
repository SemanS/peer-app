import { useState } from "react";

import { shownRows, SIDEBAR_ROWS } from "./sidebarRows.logic";

/** A section's rows up to its limit, and the Show more / Show less row that goes under them. */
export function useSidebarRows<Row>(rows: ReadonlyArray<Row>, isOpen: (row: Row) => boolean) {
  const [shown, setShown] = useState(SIDEBAR_ROWS);
  const { rows: visible, hidden } = shownRows(rows, shown, isOpen);
  const expanded = shown > SIDEBAR_ROWS;
  const more =
    hidden > 0 || expanded ? (
      <button
        type="button"
        className="w-fit rounded-sm px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setShown(hidden > 0 ? shown + SIDEBAR_ROWS : SIDEBAR_ROWS)}
      >
        {hidden > 0 ? "Show more" : "Show less"}
      </button>
    ) : null;
  return { visible, more };
}
