/** Explicit operator choice wins; packaged resources otherwise supply Peer's standalone engine. */
export function kontextEnvironment(input: {
  readonly explicit: string | undefined;
  readonly packaged: boolean;
  readonly resourcePath: string;
  readonly exists: boolean;
}): Readonly<Record<string, string>> {
  if (input.explicit !== undefined && input.explicit !== "") return { KONTEXT_BIN: input.explicit };
  return input.packaged && input.exists ? { KONTEXT_BIN: input.resourcePath } : {};
}
