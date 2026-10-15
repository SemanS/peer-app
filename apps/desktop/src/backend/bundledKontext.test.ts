import { describe, expect, it } from "@effect/vitest";
import { kontextEnvironment } from "./bundledKontext.ts";

describe("the desktop's standalone kontext engine", () => {
  const packaged = {
    explicit: undefined,
    packaged: true,
    resourcePath: "/Resources/kontext/kontext",
    exists: true,
  };
  it("passes the packaged resource to the backend and honors explicit overrides", () => {
    expect(kontextEnvironment(packaged)).toEqual({ KONTEXT_BIN: packaged.resourcePath });
    expect(kontextEnvironment({ ...packaged, explicit: "/opt/kontext" })).toEqual({
      KONTEXT_BIN: "/opt/kontext",
    });
  });
  it("keeps PATH available in development or without a bundled resource", () => {
    expect(kontextEnvironment({ ...packaged, packaged: false })).toEqual({});
    expect(kontextEnvironment({ ...packaged, exists: false })).toEqual({});
  });
});
