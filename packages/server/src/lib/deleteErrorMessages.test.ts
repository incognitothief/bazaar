import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-consistency check between the server's delete error codes and the
 * merchant-facing wording in the client.
 *
 * This lives in the server suite on purpose: CI runs `npm run test -w
 * @bazaar/server` and nothing else (.github/workflows/test.yml), and the
 * client package has no test runner. A guard in the client would never
 * execute. It reads both files as text rather than importing the client
 * module, since the client isn't built or resolvable from here.
 */

const ROOT = join(import.meta.dir, "../../../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function slice(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start === -1) throw new Error(`anchor not found: ${from}`);
  const end = src.indexOf(to, start);
  return src.slice(start, end === -1 ? undefined : end);
}

function codesIn(src: string): string[] {
  return [...src.matchAll(/error: "([a-z0-9_]+)"/g)].map((m) => m[1]);
}

const merchantRoutes = read("packages/server/src/routes/merchant.ts");

const serverCodes = new Set([
  ...codesIn(read("packages/server/src/lib/deleteCatalogEntry.ts")),
  ...codesIn(slice(merchantRoutes, "/catalog/entry/delete-manifest", "\n  return r;")),
  ...codesIn(slice(merchantRoutes, "function merchantGuard", "\nexport function createMerchantRouter")),
]);

const clientApi = read("packages/client/src/lib/api/catalogDeleteApi.ts");
const mapBody = slice(
  clientApi,
  "const DELETE_ERROR_MESSAGES",
  "\n};",
);
const messages = new Map(
  [...mapBody.matchAll(/([a-z0-9_]+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]),
);

describe("delete error messages", () => {
  test("the server actually emits codes and the client actually maps some", () => {
    expect(serverCodes.size).toBeGreaterThan(5);
    expect(messages.size).toBeGreaterThan(5);
  });

  test("every server code has merchant-facing wording", () => {
    const unmapped = [...serverCodes].filter((c) => !messages.has(c));
    expect(unmapped).toEqual([]);
  });

  test("no orphaned messages for codes the server no longer emits", () => {
    const orphaned = [...messages.keys()].filter((c) => !serverCodes.has(c));
    expect(orphaned).toEqual([]);
  });

  test("could-not-delete and could-not-confirm read differently", () => {
    expect(messages.get("r2_delete_incomplete")).not.toBe(messages.get("r2_verify_failed"));
  });

  /**
   * The aborts leave everything intact; record_delete_failed does not -- bytes
   * and ERP rows are already gone by then. Telling a merchant otherwise would
   * be a factual error, not a tone problem. See ADR 0017.
   */
  test("record_delete_failed does not claim nothing was deleted", () => {
    const msg = messages.get("record_delete_failed") ?? "";
    expect(msg).not.toMatch(/untouched|nothing was deleted/i);
  });

  test("the pre-step-3 aborts do reassure that records are intact", () => {
    for (const code of ["r2_delete_failed", "r2_verify_failed", "r2_delete_incomplete"]) {
      expect(messages.get(code) ?? "").toMatch(/untouched|nothing/i);
    }
  });
});
