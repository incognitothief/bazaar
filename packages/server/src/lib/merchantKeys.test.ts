import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import {
  buildServiceDidDocument,
  candidatePemsForKid,
  getMerchantKeys,
  parseKeyHistoryEnv,
  resetMerchantKeysCache,
} from "./merchantKeys";
import { publicSpkiPemToMultibase } from "./publicKeyMultibase";

const DID = "did:web:bazaar.whereditgo.diamonds";

function p256() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    multibase: publicSpkiPemToMultibase(
      publicKey.export({ type: "spki", format: "pem" }) as string,
    ),
  };
}

const ENV_KEYS = [
  "APP_DID",
  "APP_MERCHANT_PRIVATE_KEY",
  "APP_MERCHANT_KID",
  "APP_MERCHANT_PUBLIC_MULTIBASE",
  "APP_MERCHANT_KEY_HISTORY",
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetMerchantKeysCache();
});

function setEnv(e: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.APP_DID = DID;
  for (const [k, v] of Object.entries(e)) process.env[k] = v;
  resetMerchantKeysCache();
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const histEntry = (kid: string, mb: string, next: string, revoked?: boolean) => ({
  id: `${DID}#${kid}`,
  type: "Multikey" as const,
  publicKeyMultibase: mb,
  supersededBy: `${DID}#${next}`,
  ...(revoked ? { revoked: true } : {}),
});

describe("parseKeyHistoryEnv", () => {
  const { multibase } = p256();
  const e = histEntry("merchant-key-2026-01-10", multibase, "merchant-key-2026-08-29");

  test("empty / placeholder → []", () => {
    process.env.APP_DID = DID;
    expect(parseKeyHistoryEnv(undefined)).toEqual([]);
    expect(parseKeyHistoryEnv("PLACEHOLDER")).toEqual([]);
  });

  test("base64 and bare JSON; bare fragments are expanded with APP_DID", () => {
    process.env.APP_DID = DID;
    expect(parseKeyHistoryEnv(b64([e]))[0]!.id).toBe(e.id);
    expect(parseKeyHistoryEnv(JSON.stringify([e]))[0]!.id).toBe(e.id);
    const bare = parseKeyHistoryEnv(
      b64([
        {
          id: "merchant-key-2026-01-10",
          publicKeyMultibase: multibase,
          supersededBy: "merchant-key-2026-08-29",
        },
      ]),
    );
    expect(bare[0]!.id).toBe(`${DID}#merchant-key-2026-01-10`);
    expect(bare[0]!.supersededBy).toBe(`${DID}#merchant-key-2026-08-29`);
    expect(bare[0]!.type).toBe("Multikey");
  });

  test("carries revoked:true through; omits it otherwise", () => {
    process.env.APP_DID = DID;
    expect(
      parseKeyHistoryEnv(b64([histEntry("k", multibase, "n", true)]))[0]!.revoked,
    ).toBe(true);
    expect("revoked" in parseKeyHistoryEnv(b64([e]))[0]!).toBe(false);
  });

  test("throws on non-array, missing id, missing supersededBy, non-boolean revoked, bad key", () => {
    process.env.APP_DID = DID;
    expect(() => parseKeyHistoryEnv(b64({}))).toThrow(/array/);
    expect(() =>
      parseKeyHistoryEnv(b64([{ publicKeyMultibase: multibase, supersededBy: "n" }])),
    ).toThrow(/"id"/);
    expect(() =>
      parseKeyHistoryEnv(b64([{ id: "k", publicKeyMultibase: multibase }])),
    ).toThrow(/supersededBy/);
    expect(() =>
      parseKeyHistoryEnv(b64([{ ...e, revoked: "yes" }])),
    ).toThrow(/boolean/);
    expect(() =>
      parseKeyHistoryEnv(b64([{ ...e, publicKeyMultibase: "znope" }])),
    ).toThrow();
  });
});

describe("getMerchantKeys", () => {
  test("current key from env, no history", () => {
    const cur = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-2026-08-29",
    });
    const keys = getMerchantKeys();
    expect(keys.current?.kid).toBe("merchant-key-2026-08-29");
    expect(keys.current?.id).toBe(`${DID}#merchant-key-2026-08-29`);
    expect(keys.current?.kind).toBe("current");
    expect(keys.current?.revoked).toBe(false);
    expect(keys.history).toEqual([]);
  });

  test("current + history; retired vs revoked", () => {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-2026-08-29",
      APP_MERCHANT_KEY_HISTORY: b64([
        histEntry("merchant-key-2026-04-17", retired.multibase, "merchant-key-2026-08-29"),
        histEntry("merchant-key-2026-01-01", revoked.multibase, "merchant-key-2026-04-17", true),
      ]),
    });
    const keys = getMerchantKeys();
    expect(keys.history.map((h) => [h.kid, h.kind, h.revoked])).toEqual([
      ["merchant-key-2026-04-17", "retired", false],
      ["merchant-key-2026-01-01", "retired", true],
    ]);
    expect(keys.history[0]!.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(keys.byKid.size).toBe(3);
  });

  test("current key also in history → throws; PUBLIC_MULTIBASE mismatch → throws", () => {
    const cur = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "dup",
      APP_MERCHANT_KEY_HISTORY: b64([histEntry("dup", cur.multibase, "dup")]),
    });
    expect(() => getMerchantKeys()).toThrow(/also appears/);

    const other = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "x",
      APP_MERCHANT_PUBLIC_MULTIBASE: other.multibase,
    });
    expect(() => getMerchantKeys()).toThrow(/does not match/);
  });
});

describe("candidatePemsForKid", () => {
  function fixture() {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "cur",
      APP_MERCHANT_KEY_HISTORY: b64([
        histEntry("retired", retired.multibase, "cur"),
        histEntry("revoked", revoked.multibase, "retired", true),
      ]),
    });
    return getMerchantKeys();
  }

  test("revoked kid → hard reject, no candidates", () => {
    expect(candidatePemsForKid(fixture(), "revoked")).toEqual({
      revoked: true,
      pems: [],
    });
  });

  test("retired kid → that key first, then current; revoked key never appears", () => {
    const keys = fixture();
    const { revoked, pems } = candidatePemsForKid(keys, "retired");
    expect(revoked).toBe(false);
    expect(pems[0]).toBe(keys.byKid.get("retired")!.publicKeyPem);
    expect(pems).toContain(keys.current!.publicKeyPem);
    expect(pems).not.toContain(keys.byKid.get("revoked")!.publicKeyPem);
    expect(pems.length).toBe(2);
  });

  test("no kid → current then non-revoked history", () => {
    const keys = fixture();
    const { pems } = candidatePemsForKid(keys, undefined);
    expect(pems[0]).toBe(keys.current!.publicKeyPem);
    expect(pems.length).toBe(2);
  });
});

describe("buildServiceDidDocument", () => {
  test("verificationMethod = current only; assertionMethod = current; keyHistory full URLs; no authentication", () => {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-2026-08-29",
      APP_MERCHANT_KEY_HISTORY: b64([
        histEntry("merchant-key-2026-04-17", retired.multibase, "merchant-key-2026-08-29"),
        histEntry("merchant-key-2026-01-01", revoked.multibase, "merchant-key-2026-04-17", true),
      ]),
    });
    const doc = buildServiceDidDocument(getMerchantKeys(), [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ]) as any;

    expect(doc.verificationMethod.map((v: any) => v.id)).toEqual([
      `${DID}#merchant-key-2026-08-29`,
    ]);
    expect(doc.assertionMethod).toEqual([`${DID}#merchant-key-2026-08-29`]);
    expect(doc.keyHistory.map((h: any) => h.id)).toEqual([
      `${DID}#merchant-key-2026-04-17`,
      `${DID}#merchant-key-2026-01-01`,
    ]);
    expect(doc.keyHistory[0]!.type).toBe("Multikey");
    expect(doc.keyHistory[0]!.supersededBy).toBe(`${DID}#merchant-key-2026-08-29`);
    expect("revoked" in doc.keyHistory[0]!).toBe(false);
    expect(doc.keyHistory[1]!.revoked).toBe(true);
    expect("authentication" in doc).toBe(false);

    const ctx = doc["@context"].at(-1);
    expect(ctx.keyHistory["@container"]).toBe("@list");
    expect(ctx.supersededBy).toEqual({
      "@id": "https://bazaar.whereditgo.diamonds/ns#supersededBy",
      "@type": "@id",
    });
    expect(String(ctx.revoked)).toContain("/ns#revoked");
  });

  test("no current key → empty verificationMethod / assertionMethod", () => {
    setEnv({});
    const doc = buildServiceDidDocument(getMerchantKeys(), [
      "https://www.w3.org/ns/did/v1",
    ]) as any;
    expect(doc.verificationMethod).toEqual([]);
    expect(doc.assertionMethod).toEqual([]);
    expect(doc.keyHistory).toEqual([]);
  });
});
