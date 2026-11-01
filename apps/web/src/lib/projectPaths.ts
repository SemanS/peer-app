export {
  appendBrowsePathSegment,
  canNavigateUp,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  normalizeProjectPathForComparison,
  resolveProjectPathForDispatch,
  withoutHomePrefixBeforeAbsolutePath,
} from "@t3tools/client-runtime/state/projects";

export { normalizeProjectPathForDispatch } from "@t3tools/shared/path";
