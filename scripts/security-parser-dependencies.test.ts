// @effect-diagnostics nodeBuiltinImport:off - Exercises dependencies resolved through their actual consumers.
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";

import { assert, describe, it } from "@effect/vitest";

function consumerRequire(workspace: string, dependencies: ReadonlyArray<string>) {
  let require = NodeModule.createRequire(
    new URL(`../apps/${workspace}/package.json`, import.meta.url),
  );
  for (const dependency of dependencies) {
    require = NodeModule.createRequire(require.resolve(`${dependency}/package.json`));
  }
  return require;
}

interface RsaPublicKey {
  verify(
    digest: string,
    signature: string,
    scheme?: undefined,
    options?: { readonly _skipPaddingChecks: boolean },
  ): boolean;
}

const forge = consumerRequire("mobile", ["expo", "@expo/cli"])("node-forge") as {
  readonly jsbn: {
    readonly BigInteger: new (value: string, radix?: number) => unknown;
  };
  readonly pki: {
    readonly rsa: {
      readonly setPublicKey: (modulus: unknown, exponent: unknown) => RsaPublicKey;
    };
    readonly publicKeyFromPem: (pem: string) => RsaPublicKey;
  };
};

// Public no-private-key forgery vector from https://github.com/digitalbazaar/forge/pull/1160.
const modulus =
  "E932AC92252F585B3A80A4DD76A897C8B7652952FE788F6EC8DD640587A1EE56" +
  "47670A8AD4C2BE0F9FA6E49C605ADF77B5174230AF7BD50E5D6D6D6D28CCF0A8" +
  "86A514CC72E51D209CC772A52EF419F6A953F3135929588EBE9B351FCA61CED7" +
  "8F346FE00DBB6306E5C2A4C6DFC3779AF85AB417371CF34D8387B9B30AE46D7A" +
  "5FF5A655B8D8455F1B94AE736989D60A6F2FD5CADBFFBD504C5A756A2E6BB5CE" +
  "CC13BCA7503F6DF8B52ACE5C410997E98809DB4DC30D943DE4E812A47553DCE5" +
  "4844A78E36401D13F77DC650619FED88D8B3926E3D8E319C80C744779AC5D6AB" +
  "E252896950917476ECE5E8FC27D5F053D6018D91B502C4787558A002B9283DA7";
const nestedGarbageSignature = Buffer.from(
  "00000000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000000000" +
    "00000000000000000000000000000000000000000000000000000000000000000000" +
    "0032cbfd4a7adc7905583d7920d7165d77cf8d6f4b19a4c14026dc9bf5576b2de2aa" +
    "b4a0dc9d8303ba8e365764f52a49da7a2dfc5bed616f52d37d860cb283543d93fe1b" +
    "73ca6379278422fd8821eeeddc3a1bee99f9",
  "hex",
).toString("binary");

const digest = (message: string) =>
  NodeCrypto.createHash("sha256").update(message).digest("binary");

describe("Expo CLI RSA signature verification", () => {
  // Public structural controls from upstream PR 1160. e=1 makes the encoded
  // message visible to the parser; the separate e=3 vector tests real forgery.
  const structuralKey = forge.pki.rsa.setPublicKey(
    new forge.jsbn.BigInteger("f".repeat(256), 16),
    new forge.jsbn.BigInteger("1", 10),
  );
  const digestHex = NodeCrypto.createHash("sha256").update("hello world!").digest("hex");
  const signatureForDigestInfo = (hex: string) => {
    const info = Buffer.from(hex, "hex");
    return Buffer.concat([
      Buffer.from([0, 1]),
      Buffer.alloc(128 - 3 - info.length, 0xff),
      Buffer.from([0]),
      info,
    ]).toString("binary");
  };

  it.each([
    ["empty NULL parameters", `3031300d060960864801650304020105000420${digestHex}`],
    ["absent parameters", `302f300b06096086480165030402010420${digestHex}`],
  ])("accepts canonical DigestInfo with %s", (_name, hex) => {
    assert.strictEqual(
      structuralKey.verify(digest("hello world!"), signatureForDigestInfo(hex)),
      true,
    );
  });

  it.each([
    ["NULL content", `3033300f06096086480165030402010502beef0420${digestHex}`],
    ["nonminimal length octets", `30813230810d060960864801650304020105000420${digestHex}`],
    ["non-NULL parameters", `3033300f06096086480165030402010202beef0420${digestHex}`],
    ["extra inner child", `3033300f0609608648016503040201050005000420${digestHex}`],
    ["extra outer child", `3033300d060960864801650304020105000420${digestHex}0500`],
  ])("rejects noncanonical DigestInfo containing %s", (_name, hex) => {
    for (const options of [undefined, { _skipPaddingChecks: true }]) {
      assert.throws(
        () =>
          structuralKey.verify(
            digest("hello world!"),
            signatureForDigestInfo(hex),
            undefined,
            options,
          ),
        /valid RSASSA-PKCS1-v1_5 DigestInfo/,
      );
    }
  });

  it("rejects extra nested DigestAlgorithm elements", () => {
    const key = forge.pki.rsa.setPublicKey(
      new forge.jsbn.BigInteger(modulus, 16),
      new forge.jsbn.BigInteger("3"),
    );
    for (const options of [undefined, { _skipPaddingChecks: true }]) {
      assert.throws(
        () => key.verify(digest("hello world!"), nestedGarbageSignature, undefined, options),
        /valid RSASSA-PKCS1-v1_5 DigestInfo/,
      );
    }
  });

  it("accepts a valid signature and rejects the same signature for another message", () => {
    const keys = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
    const key = forge.pki.publicKeyFromPem(
      keys.publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
    );
    const signature = NodeCrypto.sign(
      "sha256",
      Buffer.from("valid control"),
      keys.privateKey,
    ).toString("binary");
    assert.strictEqual(key.verify(digest("valid control"), signature), true);
    assert.strictEqual(key.verify(digest("different message"), signature), false);
  });
});

interface CacheRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface CachePolicyInstance {
  now(): number;
  satisfiesWithoutRevalidation(request: CacheRequest): boolean;
  useStaleWhileRevalidate(): boolean;
  evaluateRequest(request: CacheRequest): {
    readonly response?: unknown;
    readonly revalidation?: { readonly synchronous: boolean };
  };
  revalidatedPolicy(
    request: CacheRequest,
    response: { readonly status: number; readonly headers: Readonly<Record<string, string>> },
  ): {
    readonly policy: CachePolicyInstance;
    readonly modified: boolean;
    readonly matches: boolean;
  };
  toObject(): unknown;
}

const CachePolicy = consumerRequire("marketing", ["astro"])("http-cache-semantics") as {
  new (
    request: CacheRequest,
    response: { readonly status: number; readonly headers: Readonly<Record<string, string>> },
    options?: { readonly shared: boolean },
  ): CachePolicyInstance;
  fromObject(serialized: unknown): CachePolicyInstance;
};

const now = Date.parse("2026-10-25T00:00:00.000Z");
class FixedTimeCachePolicy extends CachePolicy {
  override now() {
    return now;
  }
}

const request = {
  method: "GET",
  url: "https://example.test/account",
  headers: { host: "example.test" },
};

function cachePolicy(headers: Readonly<Record<string, string>>, shared = true) {
  return new FixedTimeCachePolicy(
    request,
    { status: 200, headers: { date: "Sun, 25 Oct 2026 00:00:00 GMT", age: "10", ...headers } },
    { shared },
  );
}

describe("Astro cache revalidation", () => {
  const revalidationCases = [
    ["shared session cookies", { "cache-control": "max-age=1", "set-cookie": "session=victim" }],
    ["proxy-revalidate", { "cache-control": "proxy-revalidate, max-age=1" }],
    ["no-cache", { "cache-control": "no-cache, max-age=1" }],
    ["private responses in a shared cache", { "cache-control": "private, max-age=1" }],
    ["no-store", { "cache-control": "no-store, max-age=1" }],
    ["must-revalidate", { "cache-control": "must-revalidate, max-age=1" }],
    ["Vary wildcard", { "cache-control": "max-age=1", vary: "*" }],
    ["Vary wildcard among named headers", { "cache-control": "max-age=1", vary: "Accept, *" }],
    [
      "no-cache with background revalidation",
      { "cache-control": "no-cache, stale-while-revalidate=3600" },
    ],
  ] as const;

  it.each(revalidationCases)(
    "requires origin validation for %s despite max-stale",
    (_name, headers) => {
      const policy = cachePolicy(headers);
      const restored = FixedTimeCachePolicy.fromObject(policy.toObject());
      for (const candidate of [policy, restored]) {
        for (const cacheControl of ["max-stale", "max-stale=999999"]) {
          const nextRequest = {
            ...request,
            headers: { ...request.headers, "cache-control": cacheControl },
          };
          assert.strictEqual(candidate.satisfiesWithoutRevalidation(nextRequest), false);
          const decision = candidate.evaluateRequest(nextRequest);
          assert.strictEqual(decision.response, undefined);
          assert.strictEqual(decision.revalidation?.synchronous, true);
          assert.strictEqual(candidate.useStaleWhileRevalidate(), false);
        }
      }
    },
  );

  it.each(revalidationCases)(
    "does not reuse %s when the origin returns an error",
    (_name, headers) => {
      const policy = cachePolicy({
        ...headers,
        "cache-control": `${headers["cache-control"]}, stale-if-error=3600`,
      });
      const restored = FixedTimeCachePolicy.fromObject(policy.toObject());
      for (const candidate of [policy, restored]) {
        const decision = candidate.revalidatedPolicy(request, { status: 503, headers: {} });
        assert.strictEqual(decision.matches, false);
        assert.strictEqual(decision.modified, true);
        assert.notStrictEqual(decision.policy, candidate);
      }
    },
  );

  it("keeps ordinary expiry and explicit public or private-cache stale reuse working", () => {
    const policies = [
      cachePolicy({ "cache-control": "max-age=1" }),
      cachePolicy({ "cache-control": "public, max-age=1", "set-cookie": "session=public" }),
      cachePolicy(
        { "cache-control": "private, max-age=1", "set-cookie": "session=private" },
        false,
      ),
    ];
    const nextRequest = {
      ...request,
      headers: { ...request.headers, "cache-control": "max-stale=999999" },
    };
    for (const policy of policies) {
      assert.strictEqual(policy.satisfiesWithoutRevalidation(nextRequest), true);
      assert.notStrictEqual(policy.evaluateRequest(nextRequest).response, undefined);
    }
  });

  it("keeps stale-if-error working for ordinary expiry and public or private caches", () => {
    const policies = [
      cachePolicy({ "cache-control": "max-age=1, stale-if-error=60" }),
      cachePolicy({
        "cache-control": "public, max-age=1, stale-if-error=60",
        "set-cookie": "session=public",
      }),
      cachePolicy(
        {
          "cache-control": "private, max-age=1, stale-if-error=60",
          "set-cookie": "session=private",
        },
        false,
      ),
    ];
    for (const policy of policies) {
      const decision = policy.revalidatedPolicy(request, { status: 503, headers: {} });
      assert.strictEqual(decision.matches, true);
      assert.strictEqual(decision.modified, false);
      assert.strictEqual(decision.policy, policy);
    }
  });

  it("reuses stale-if-error only for the matching request variant", () => {
    const original = { ...request, headers: { ...request.headers, cookie: "session=alice" } };
    const policy = new FixedTimeCachePolicy(original, {
      status: 200,
      headers: {
        date: "Sun, 25 Oct 2026 00:00:00 GMT",
        age: "10",
        vary: "cookie",
        "cache-control": "public, max-age=1, stale-if-error=60",
      },
    });
    for (const candidate of [policy, FixedTimeCachePolicy.fromObject(policy.toObject())]) {
      for (const matching of [original, { ...original, method: "HEAD" }]) {
        assert.strictEqual(
          candidate.revalidatedPolicy(matching, { status: 503, headers: {} }).policy,
          candidate,
        );
      }
      for (const different of [
        { ...original, headers: { ...original.headers, cookie: "session=bob" } },
        { ...original, url: "https://example.test/other" },
        { ...original, method: "POST" },
      ]) {
        const decision = candidate.revalidatedPolicy(different, { status: 503, headers: {} });
        assert.strictEqual(decision.matches, false);
        assert.strictEqual(decision.modified, true);
        assert.notStrictEqual(decision.policy, candidate);
      }
    }
  });
});
