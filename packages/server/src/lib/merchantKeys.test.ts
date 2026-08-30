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

function p256() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  return { privateKeyPem, multibase: publicSpkiPemToMultibase(publicKeyPem) };
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
  for (const [k, v] of Object.entries(e)) process.env[k] = v;
  resetMerchantKeysCache();
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

describe("parseKeyHistoryEnv", () => {
  const { multibase } = p256();
  const entry = {
    kid: "merchant-key-2026-01-10",
    publicKeyMultibase: multibase,
    status: "retired" as const,
    supersededBy: "merchant-key-2026-08-29",
  };

  test("empty / placeholder → []", () => {
    expect(parseKeyHistoryEnv(undefined)).toEqual([]);
    expect(parseKeyHistoryEnv("   ")).toEqual([]);
    expect(parseKeyHistoryEnv("PLACEHOLDER")).toEqual([]);
  });

  test("accepts base64(JSON) and bare JSON", () => {
    expect(parseKeyHistoryEnv(b64([entry]))[0]!.kid).toBe(entry.kid);
    expect(parseKeyHistoryEnv(JSON.stringify([entry]))[0]!.kid).toBe(entry.kid);
  });

  test("throws on non-array, bad status, missing fields, undecodable key", () => {
    expect(() => parseKeyHistoryEnv(b64({ nope: 1 }))).toThrow(/array/);
    expect(() => parseKeyHistoryEnv(b64([{ ...entry, status: "gone" }]))).toThrow(
      /status/,
    );
    expect(() =>
      parseKeyHistoryEnv(b64([{ publicKeyMultibase: multibase, status: "retired", supersededBy: "x" }])),
    ).toThrow(/kid/);
    expect(() =>
      parseKeyHistoryEnv(b64([{ ...entry, publicKeyMultibase: "znotarealkey" }])),
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
    expect(keys.current?.publicKeyMultibase).toBe(cur.multibase);
    expect(keys.current?.status).toBe("current");
    expect(keys.history).toEqual([]);
    expect(keys.byKid.size).toBe(1);
  });

  test("current + history", () => {
    const cur = p256();
    const old = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-2026-08-29",
      APP_MERCHANT_KEY_HISTORY: b64([
        {
          kid: "merchant-key-2026-01-10",
          publicKeyMultibase: old.multibase,
          status: "retired",
          supersededBy: "merchant-key-2026-08-29",
        },
      ]),
    });
    const keys = getMerchantKeys();
    expect(keys.history.map((h) => h.kid)).toEqual(["merchant-key-2026-01-10"]);
    expect(keys.history[0]!.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(keys.byKid.size).toBe(2);
  });

  test("current key also present in history → throws", () => {
    const cur = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-dup",
      APP_MERCHANT_KEY_HISTORY: b64([
        {
          kid: "merchant-key-dup",
          publicKeyMultibase: cur.multibase,
          status: "retired",
          supersededBy: "merchant-key-dup",
        },
      ]),
    });
    expect(() => getMerchantKeys()).toThrow(/also appears/);
  });

  test("PUBLIC_MULTIBASE mismatch → throws", () => {
    const cur = p256();
    const other = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-x",
      APP_MERCHANT_PUBLIC_MULTIBASE: other.multibase,
    });
    expect(() => getMerchantKeys()).toThrow(/does not match/);
  });
});

describe("candidatePemsForKid", () => {
  function keysWith() {
    const cur = p256();
    const active = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "cur",
      APP_MERCHANT_KEY_HISTORY: b64([
        { kid: "active", publicKeyMultibase: active.multibase, status: "active", supersededBy: "cur" },
        { kid: "retired", publicKeyMultibase: retired.multibase, status: "retired", supersededBy: "active" },
        { kid: "revoked", publicKeyMultibase: revoked.multibase, status: "revoked", supersededBy: "retired" },
      ]),
    });
    return { keys: getMerchantKeys(), cur, active, retired, revoked };
  }

  test("revoked kid → hard reject, no candidates", () => {
    const { keys } = keysWith();
    expect(candidatePemsForKid(keys, "revoked")).toEqual({ revoked: true, pems: [] });
  });

  test("hinted key first, then current + non-revoked newest→oldest", () => {
    const { keys, cur, active, retired } = keysWith();
    const { revoked, pems } = candidatePemsForKid(keys, "retired");
    expect(revoked).toBe(false);
    expect(pems[0]).toBe(retired ? keys.byKid.get("retired")!.publicKeyPem : "");
    // no revoked key material anywhere in the list
    expect(pems).not.toContain(keys.byKid.get("revoked")?.publicKeyPem);
    expect(pems).toContain(cur ? keys.current!.publicKeyPem : "");
    expect(pems).toContain(keys.byKid.get("active")!.publicKeyPem);
  });

  test("unknown / missing kid → current then non-revoked history", () => {
    const { keys } = keysWith();
    const { pems } = candidatePemsForKid(keys, undefined);
    expect(pems[0]).toBe(keys.current!.publicKeyPem);
    expect(pems.length).toBe(3); // current + active + retired (revoked excluded)
  });
});

describe("buildServiceDidDocument", () => {
  test("verificationMethod = current + active; assertionMethod = current; keyHistory full; no authentication", () => {
    const cur = p256();
    const active = p256();
    const retired = p256();
    setEnv({
      APP_DID: "did:web:bazaar.whereditgo.diamonds",
      APP_MERCHANT_PRIVATE_KEY: cur.privateKeyPem,
      APP_MERCHANT_KID: "merchant-key-2026-08-29",
      APP_MERCHANT_KEY_HISTORY: b64([
        { kid: "merchant-key-2026-04-17", publicKeyMultibase: active.multibase, status: "active", supersededBy: "merchant-key-2026-08-29" },
        { kid: "merchant-key-2026-01-10", publicKeyMultibase: retired.multibase, status: "retired", supersededBy: "merchant-key-2026-04-17" },
      ]),
    });
    const doc = buildServiceDidDocument(getMerchantKeys(), {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/multikey/v1",
      ],
      id: "did:web:bazaar.whereditgo.diamonds",
    }) as any;

    expect(doc.verificationMethod.map((v: any) => v.id)).toEqual([
      "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29",
      "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-04-17",
    ]);
    expect(doc.assertionMethod).toEqual([
      "did:web:bazaar.whereditgo.diamonds#merchant-key-2026-08-29",
    ]);
    expect(doc.keyHistory.map((h: any) => h.kid)).toEqual([
      "merchant-key-2026-04-17",
      "merchant-key-2026-01-10",
    ]);
    expect("authentication" in doc).toBe(false);
    const ctxObj = doc["@context"].at(-1);
    expect(ctxObj.keyHistory["@container"]).toBe("@list");
    expect(String(ctxObj.keyHistory["@id"])).toContain("bazaar.whereditgo.diamonds/ns#");
  });

  test("no current key → empty verificationMethod / assertionMethod", () => {
    setEnv({});
    const doc = buildServiceDidDocument(getMerchantKeys(), {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: "did:web:bazaar.whereditgo.diamonds",
    }) as any;
    expect(doc.verificationMethod).toEqual([]);
    expect(doc.assertionMethod).toEqual([]);
    expect(doc.keyHistory).toEqual([]);
  });
});
