import { describe, expect, it } from "vite-plus/test";

import { gatewayKeyMissing } from "./capacity.logic";

describe("a gateway without its master key", () => {
  it("is what the Hub says when it has no admin key for the workspace's gateway", () => {
    expect(gatewayKeyMissing("the workspace's gateway has no admin key yet")).toBe(true);
    expect(gatewayKeyMissing("No gateway admin key yet")).toBe(true);
  });

  it("is not any other trouble with shared capacity", () => {
    expect(gatewayKeyMissing(undefined)).toBe(false);
    expect(gatewayKeyMissing("")).toBe(false);
    expect(
      gatewayKeyMissing("you hold 5 keys in this workspace; revoke the ones you do not use"),
    ).toBe(false);
    expect(gatewayKeyMissing("Could not reach the hub at https://hub.example.test")).toBe(false);
  });
});
