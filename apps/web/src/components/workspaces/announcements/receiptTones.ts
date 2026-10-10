/** The tone of each receipt state: how far an announcement got with an agent. */
export const RECEIPT_BADGE = {
  acknowledged: "success",
  "model-input": "team",
  offered: "info",
  waiting: "secondary",
  "not-following": "warning",
} as const;
