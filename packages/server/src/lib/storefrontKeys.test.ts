import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";
import {
  buildServiceDidDocument,
  candidatePemsForKid,
  diffStorefrontKeyMirror,
  expectedStorefrontKeyRecords,
  getStorefrontKeys,
  KEY_HISTORY_CONTEXT_URL,
  keyHistoryContextDocument,
  parseKeyHistoryEnv,
  resetStorefrontKeysCache,
} from "./storefrontKeys";
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
  "STOREFRONT_DID",
  "STOREFRONT_PRIVATE_KEY",
  "STOREFRONT_KID",
  "STOREFRONT_PUBLIC_MULTIBASE",
  "STOREFRONT_KEY_HISTORY",
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetStorefrontKeysCache();
});

function setEnv(e: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.STOREFRONT_DID = DID;
  for (const [k, v] of Object.entries(e)) process.env[k] = v;
  // STOREFRONT_PUBLIC_MULTIBASE is required alongside a private key. Derive it so each test
  // states only what it is actually about; the mismatch cases pass it explicitly.
  if (e.STOREFRONT_PRIVATE_KEY && !e.STOREFRONT_PUBLIC_MULTIBASE) {
    process.env.STOREFRONT_PUBLIC_MULTIBASE = publicSpkiPemToMultibase(
      createPublicKey(createPrivateKey(e.STOREFRONT_PRIVATE_KEY)).export({
        type: "spki",
        format: "pem",
      }) as string,
    );
  }
  resetStorefrontKeysCache();
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
  const e = histEntry("storefront-key-2026-01-10", multibase, "storefront-key-2026-08-29");

  test("empty / placeholder → []", () => {
    process.env.STOREFRONT_DID = DID;
    expect(parseKeyHistoryEnv(undefined)).toEqual([]);
    expect(parseKeyHistoryEnv("PLACEHOLDER")).toEqual([]);
  });

  test("base64 and bare JSON; bare fragments are expanded with STOREFRONT_DID", () => {
    process.env.STOREFRONT_DID = DID;
    expect(parseKeyHistoryEnv(b64([e]))[0]!.id).toBe(e.id);
    expect(parseKeyHistoryEnv(JSON.stringify([e]))[0]!.id).toBe(e.id);
    const bare = parseKeyHistoryEnv(
      b64([
        {
          id: "storefront-key-2026-01-10",
          publicKeyMultibase: multibase,
          supersededBy: "storefront-key-2026-08-29",
        },
      ]),
    );
    expect(bare[0]!.id).toBe(`${DID}#storefront-key-2026-01-10`);
    expect(bare[0]!.supersededBy).toBe(`${DID}#storefront-key-2026-08-29`);
    expect(bare[0]!.type).toBe("Multikey");
  });

  test("carries revoked:true through; omits it otherwise", () => {
    process.env.STOREFRONT_DID = DID;
    expect(
      parseKeyHistoryEnv(b64([histEntry("k", multibase, "n", true)]))[0]!.revoked,
    ).toBe(true);
    expect("revoked" in parseKeyHistoryEnv(b64([e]))[0]!).toBe(false);
  });

  test("throws on non-array, missing id, missing supersededBy, non-boolean revoked, bad key", () => {
    process.env.STOREFRONT_DID = DID;
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

describe("getStorefrontKeys", () => {
  test("current key from env, no history", () => {
    const cur = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "storefront-key-2026-08-29",
    });
    const keys = getStorefrontKeys();
    expect(keys.current?.kid).toBe("storefront-key-2026-08-29");
    expect(keys.current?.id).toBe(`${DID}#storefront-key-2026-08-29`);
    expect(keys.current?.kind).toBe("current");
    expect(keys.current?.revoked).toBe(false);
    expect(keys.history).toEqual([]);
  });

  test("current + history; retired vs revoked", () => {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "storefront-key-2026-08-29",
      STOREFRONT_KEY_HISTORY: b64([
        histEntry("storefront-key-2026-04-17", retired.multibase, "storefront-key-2026-08-29"),
        histEntry("storefront-key-2026-01-01", revoked.multibase, "storefront-key-2026-04-17", true),
      ]),
    });
    const keys = getStorefrontKeys();
    expect(keys.history.map((h) => [h.kid, h.kind, h.revoked])).toEqual([
      ["storefront-key-2026-04-17", "retired", false],
      ["storefront-key-2026-01-01", "retired", true],
    ]);
    expect(keys.history[0]!.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(keys.byKid.size).toBe(3);
  });

  test("current key also in history → throws; PUBLIC_MULTIBASE mismatch → throws", () => {
    const cur = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "dup",
      STOREFRONT_KEY_HISTORY: b64([histEntry("dup", cur.multibase, "dup")]),
    });
    expect(() => getStorefrontKeys()).toThrow(/also appears/);

    const other = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "x",
      STOREFRONT_PUBLIC_MULTIBASE: other.multibase,
    });
    expect(() => getStorefrontKeys()).toThrow(/does not match/);
  });

  /**
   * The tripwire only works if it is armed. Omitting it must fail loudly rather than fall
   * back to the derived value -- the case it exists to catch (wrong PEM under the right kid)
   * is otherwise silent and self-consistent.
   */
  test("PUBLIC_MULTIBASE omitted → throws, and names the expected value", () => {
    const cur = p256();
    setEnv({ STOREFRONT_PRIVATE_KEY: cur.privateKeyPem, STOREFRONT_KID: "x" });
    delete process.env.STOREFRONT_PUBLIC_MULTIBASE;
    resetStorefrontKeysCache();
    expect(() => getStorefrontKeys()).toThrow(/STOREFRONT_PUBLIC_MULTIBASE is required/);
    expect(() => getStorefrontKeys()).toThrow(new RegExp(cur.multibase));
  });
});

describe("candidatePemsForKid", () => {
  function fixture() {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "cur",
      STOREFRONT_KEY_HISTORY: b64([
        histEntry("retired", retired.multibase, "cur"),
        histEntry("revoked", revoked.multibase, "retired", true),
      ]),
    });
    return getStorefrontKeys();
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
  test("verificationMethod = current + non-revoked; assertionMethod = current; keyHistory full URLs; no authentication", () => {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "storefront-key-2026-08-29",
      STOREFRONT_KEY_HISTORY: b64([
        histEntry("storefront-key-2026-04-17", retired.multibase, "storefront-key-2026-08-29"),
        histEntry("storefront-key-2026-01-01", revoked.multibase, "storefront-key-2026-04-17", true),
      ]),
    });
    const doc = buildServiceDidDocument(getStorefrontKeys(), [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ]) as any;

    // current + retired (non-revoked); NOT the revoked one
    expect(doc.verificationMethod.map((v: any) => v.id)).toEqual([
      `${DID}#storefront-key-2026-08-29`,
      `${DID}#storefront-key-2026-04-17`,
    ]);
    expect(doc.verificationMethod.every((v: any) => v.controller === DID)).toBe(true);
    expect(doc.assertionMethod).toEqual([`${DID}#storefront-key-2026-08-29`]);
    expect(doc.keyHistory.map((h: any) => h.id)).toEqual([
      `${DID}#storefront-key-2026-04-17`,
      `${DID}#storefront-key-2026-01-01`,
    ]);
    expect(doc.keyHistory[0]!.type).toBe("Multikey");
    expect(doc.keyHistory.every((h: any) => h.controller === DID)).toBe(true);
    expect(doc.keyHistory[0]!.supersededBy).toBe(`${DID}#storefront-key-2026-08-29`);
    expect("revoked" in doc.keyHistory[0]!).toBe(false);
    expect(doc.keyHistory[1]!.revoked).toBe(true);
    expect("authentication" in doc).toBe(false);

    // String URL only — ATCute / Bluesky DID parsers reject inline context objects.
    expect(doc["@context"]).toEqual([
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      KEY_HISTORY_CONTEXT_URL,
    ]);
    expect(doc["@context"].every((x: unknown) => typeof x === "string")).toBe(true);

    const hosted = keyHistoryContextDocument() as any;
    expect(hosted["@context"].keyHistory["@container"]).toBe("@list");
    expect(hosted["@context"].supersededBy).toEqual({
      "@id": "https://bazaar.whereditgo.diamonds/ns#supersededBy",
      "@type": "@id",
    });
    expect(hosted["@context"].revoked).toEqual({
      "@id": "https://bazaar.whereditgo.diamonds/ns#revoked",
      "@type": "http://www.w3.org/2001/XMLSchema#boolean",
    });
  });

  test("no current key → empty verificationMethod / assertionMethod", () => {
    setEnv({});
    const doc = buildServiceDidDocument(getStorefrontKeys(), [
      "https://www.w3.org/ns/did/v1",
    ]) as any;
    expect(doc.verificationMethod).toEqual([]);
    expect(doc.assertionMethod).toEqual([]);
    expect(doc.keyHistory).toEqual([]);
  });

  test("config/bazaar-ns-v1.jsonld mirrors keyHistoryContextDocument()", () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "../../config/bazaar-ns-v1.jsonld");
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(keyHistoryContextDocument());
  });
});

describe("expectedStorefrontKeyRecords / diffStorefrontKeyMirror", () => {
  function fixture() {
    const cur = p256();
    const retired = p256();
    const revoked = p256();
    setEnv({
      STOREFRONT_PRIVATE_KEY: cur.privateKeyPem,
      STOREFRONT_KID: "cur",
      STOREFRONT_KEY_HISTORY: b64([
        histEntry("retired", retired.multibase, "cur"),
        histEntry("revoked", revoked.multibase, "retired", true),
      ]),
    });
    return { retired, revoked };
  }

  const pdsRec = (rkey: string, value: Record<string, unknown>) => ({
    uri: `at://${DID}/diamonds.whereditgo.bazaar.actor.storefrontKeys/${rkey}`,
    value,
  });

  test("expected = one record per history entry (not the current key), rkey = kid", () => {
    fixture();
    const exp = expectedStorefrontKeyRecords();
    expect(exp.map((e) => e.rkey)).toEqual(["retired", "revoked"]);
    expect(exp[0]!.record).toMatchObject({
      $type: "diamonds.whereditgo.bazaar.actor.storefrontKeys",
      id: `${DID}#retired`,
      type: "Multikey",
      controller: DID,
      supersededBy: `${DID}#cur`,
    });
    expect("revoked" in exp[0]!.record).toBe(false);
    expect(exp[1]!.record.revoked).toBe(true);
  });

  test("empty PDS → every history kid missing, nothing extra", () => {
    fixture();
    expect(diffStorefrontKeyMirror([])).toEqual({
      missing: ["retired", "revoked"],
      extra: [],
      pdsCount: 0,
    });
  });

  test("PDS matches → in sync", () => {
    fixture();
    const recs = expectedStorefrontKeyRecords().map((e) =>
      pdsRec(e.rkey, { ...e.record, syncedAt: "2026-08-30T00:00:00Z" }),
    );
    const d = diffStorefrontKeyMirror(recs);
    expect(d.missing).toEqual([]);
    expect(d.extra).toEqual([]);
    expect(d.pdsCount).toBe(2);
  });

  test("stale field (revoked flipped) → that kid missing; orphan rkey → extra", () => {
    fixture();
    const exp = expectedStorefrontKeyRecords();
    const recs = [
      pdsRec(exp[0]!.rkey, exp[0]!.record),
      // 'revoked' entry written before it was revoked
      pdsRec(exp[1]!.rkey, { ...exp[1]!.record, revoked: false }),
      pdsRec("storefront-key-ancient", { id: `${DID}#storefront-key-ancient` }),
    ];
    const d = diffStorefrontKeyMirror(recs);
    expect(d.missing).toEqual(["revoked"]);
    expect(d.extra).toEqual(["storefront-key-ancient"]);
  });
});
