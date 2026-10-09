import type { PeerWebPlugin } from "../slots.types";
import { DigestBackground } from "./DigestBackground";
import { ProjectDigest } from "./ProjectDigest";
export const digestWebPlugin: PeerWebPlugin = {
  id: "digest",
  background: DigestBackground,
  projectRows: ProjectDigest,
};
