import { createOpenSpecEnvironmentAtoms } from "@t3tools/client-runtime/peer/openspec";

import { connectionAtomRuntime } from "../../../connection/runtime";

export const openSpecAtoms = createOpenSpecEnvironmentAtoms(connectionAtomRuntime);
