import { describe, expect, it } from "vite-plus/test";

import { looksLikeEmail, signInCode } from "./peerSignIn.logic";

describe("looksLikeEmail", () => {
  it("accepts an address with a domain and refuses the rest", () => {
    expect(looksLikeEmail(" ana@acme.com ")).toBe(true);
    expect(looksLikeEmail("ana@acme")).toBe(false);
    expect(looksLikeEmail("ana acme.com")).toBe(false);
  });
});

describe("signInCode", () => {
  it("keeps the first six digits of a pasted code", () => {
    expect(signInCode("123 456")).toBe("123456");
    expect(signInCode("Code: 9876543")).toBe("987654");
  });
});
