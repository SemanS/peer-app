/** Presentation of one kontext entry; parsing and lifecycle rules belong to the engine. */
/** One entry of a project's knowledge. */
export interface KnowledgeEntry {
  readonly id: string;
  readonly publication?: { readonly state: string } | undefined;
  /** decision, convention, learning or incident. */
  readonly kind: string;
  readonly title: string;
  /** accepted, proposed, superseded; entries of the kinds without one have none. */
  readonly status: string | undefined;
  readonly date: string | undefined;
  readonly summary: string;
  readonly tags: ReadonlyArray<string>;
  /** The paths and globs it governs, relative to the repository. */
  readonly paths: ReadonlyArray<string>;
  /** Where the entry is, relative to the repository (`.ai/decisions/….md`). */
  readonly file: string;
  /** The start of its text. */
  readonly body: string;
  /**
   * Which version of the entry this is: changes when its file's text does, and only then. kontext's
   * `publication.revision` is the checkout's commit, the same for every entry.
   */
  readonly revision?: string | undefined;
  /** The day someone last confirmed it still holds (`checked` in its frontmatter), YYYY-MM-DD. */
  readonly checked?: string | undefined;
}
