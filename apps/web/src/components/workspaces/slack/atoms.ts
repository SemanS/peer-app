import { createSlackEnvironmentAtoms } from "@t3tools/client-runtime/peer/slack";
import { connectionAtomRuntime } from "../../../connection/runtime";
export const slackAtoms = createSlackEnvironmentAtoms(connectionAtomRuntime);
