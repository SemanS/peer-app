export {
  blockers as blockedBy,
  blockedLabel,
  candidates,
  cycleSentence,
  dependenciesOf,
  neededBy,
  projectDependencyIndex,
  stateWord,
  dependencyName,
} from "@t3tools/client-runtime/peer/dependencies";
export const toggleInput = (id: string, checked: boolean) =>
  checked ? { remove: [id] } : { add: [id] };
