import { describe, expect, test } from "bun:test";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { executeDeletion, type DeletionManifest } from "./deleteCatalogEntry";

const OWNER = "did:plc:owner";
const ENTRY = `at://${OWNER}/diamonds.whereditgo.bazaar.catalog.product/p1`;
const ITEM = `at://${OWNER}/diamonds.whereditgo.bazaar.catalog.item/i1`;

function manifest(over: Partial<DeletionManifest> = {}): DeletionManifest {
  return {
    entryUri: ENTRY,
    entryKind: "product",
    title: "Test Product",
    blockers: [],
    pdsRecords: [
      { uri: ITEM, collection: "diamonds.whereditgo.bazaar.catalog.item", rkey: "i1", label: "Item" },
      { uri: ENTRY, collection: "diamonds.whereditgo.bazaar.catalog.product", rkey: "p1", label: "Product" },
    ],
    r2Objects: [{ key: "inventory/x/master", label: "file", source: "indexed" }],
    objectIds: [],
    sharedItemsSkipped: [],
    receiptCount: 0,
    ...over,
  };
}

/**
 * What HeadObject actually throws for an absent key. NOT NoSuchKey -- a HEAD
 * has no response body to carry an error code, so the SDK synthesizes a bare
 * NotFound. Getting this wrong is what made an earlier version of these tests
 * pass against a verify step that rejected every successful delete.
 */
class NotFound extends Error {
  name = "NotFound";
  $metadata = { httpStatusCode: 404 };
}

/** What GetObject throws for an absent key, for contrast. */
class NoSuchKey extends Error {
  name = "NoSuchKey";
  $metadata = { httpStatusCode: 404 };
}

/** Records what the PDS was asked to delete, so we can assert it stayed untouched. */
function fakeAgent() {
  const deleted: string[] = [];
  return {
    deleted,
    agent: {
      com: {
        atproto: {
          repo: {
            deleteRecord: async (i: { rkey: string }) => {
              deleted.push(i.rkey);
              return {};
            },
          },
        },
      },
    } as never,
  };
}

/** DB that explodes if touched -- proves step 3 is never reached on abort. */
const explodingDb = new Proxy(
  {},
  {
    get() {
      throw new Error("db must not be touched when byte deletion fails");
    },
  },
) as never;

describe("executeDeletion ordering guarantee", () => {
  test("aborts before touching DB or PDS when the R2 delete fails", async () => {
    const { agent, deleted } = fakeAgent();
    const client = {
      send: async () => {
        throw new Error("network down");
      },
    };

    const res = await executeDeletion(explodingDb, agent, OWNER, manifest(), client, "bucket");

    expect(res).toEqual({ error: "r2_delete_failed", status: 502 });
    expect(deleted).toEqual([]);
  });

  test("aborts when the object is still present after a 'successful' delete", async () => {
    const { agent, deleted } = fakeAgent();
    // Delete reports success; Head still finds the object -- a silent no-op
    // delete. This must never reach record deletion.
    const client = {
      send: async (cmd: unknown) => {
        if (cmd instanceof HeadObjectCommand) return {};
        return {};
      },
    };

    const res = await executeDeletion(explodingDb, agent, OWNER, manifest(), client, "bucket");

    expect(res).toEqual({ error: "r2_delete_incomplete", status: 502 });
    expect(deleted).toEqual([]);
  });

  test("refuses outright while a listing still blocks", async () => {
    const { agent, deleted } = fakeAgent();
    const client = {
      send: async () => {
        throw new Error("R2 must not be touched when blocked");
      },
    };

    const res = await executeDeletion(
      explodingDb,
      agent,
      OWNER,
      manifest({
        blockers: [
          { kind: "listing", uri: "at://x/l/1", status: "active", targetUri: ENTRY },
        ],
      }),
      client,
      "bucket",
    );

    expect(res).toEqual({ error: "blocked_by_listings", status: 409 });
    expect(deleted).toEqual([]);
  });

  test("deletes children before the parent record once bytes are verified gone", async () => {
    const { agent, deleted } = fakeAgent();
    const client = {
      send: async (cmd: unknown) => {
        if (cmd instanceof DeleteObjectCommand) return {};
        if (cmd instanceof HeadObjectCommand) throw new NotFound();
        return {};
      },
    };
    const noopDb = {
      delete: () => ({ where: () => ({ run: () => {} }) }),
    } as never;

    const res = await executeDeletion(noopDb, agent, OWNER, manifest(), client, "bucket");

    expect("error" in res).toBe(false);
    // Parent last: its rkey is the only thing that can name a legacy entry's bytes.
    expect(deleted).toEqual(["i1", "p1"]);
  });

  test("an already-absent object is success, not failure", async () => {
    const { agent } = fakeAgent();
    // DeleteObject is idempotent, so a missing key deletes "successfully" and
    // the HEAD is what reports it gone -- the realistic path for this case.
    const client = {
      send: async (cmd: unknown) => {
        if (cmd instanceof HeadObjectCommand) throw new NotFound();
        return {};
      },
    };
    const noopDb = {
      delete: () => ({ where: () => ({ run: () => {} }) }),
    } as never;

    const res = await executeDeletion(noopDb, agent, OWNER, manifest(), client, "bucket");

    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.deletedObjects).toEqual(["inventory/x/master"]);
    }
  });

  /**
   * Regression: the verify step used to test for NoSuchKey, which HeadObject
   * never throws. Every successful delete failed verification.
   */
  test("treats a HEAD NotFound as gone, not as a verification failure", async () => {
    const { agent, deleted } = fakeAgent();
    const client = {
      send: async (cmd: unknown) => {
        if (cmd instanceof HeadObjectCommand) throw new NotFound();
        return {};
      },
    };
    const noopDb = {
      delete: () => ({ where: () => ({ run: () => {} }) }),
    } as never;

    const res = await executeDeletion(noopDb, agent, OWNER, manifest(), client, "bucket");

    expect("error" in res).toBe(false);
    expect(deleted).toEqual(["i1", "p1"]);
  });

  test("a non-404 verify error is reported as unverifiable, not as incomplete", async () => {
    const { agent, deleted } = fakeAgent();
    const client = {
      send: async (cmd: unknown) => {
        if (cmd instanceof HeadObjectCommand) throw new Error("AccessDenied");
        return {};
      },
    };

    const res = await executeDeletion(explodingDb, agent, OWNER, manifest(), client, "bucket");

    expect(res).toEqual({ error: "r2_verify_failed", status: 502 });
    expect(deleted).toEqual([]);
  });
});
