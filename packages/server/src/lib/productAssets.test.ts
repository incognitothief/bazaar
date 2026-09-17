import { describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb, type Db } from "../db";
import {
  catalogItems,
  catalogProducts,
  catalogProductAssets,
  inventoryUploadObject,
  inventoryUploadSession,
} from "../db/schema";
import { resolveCoverArtObject, resolveCoverProductUri } from "./productAssets";

const DID = "did:plc:merchant";
const PRODUCT = "diamonds.whereditgo.bazaar.catalog.product";
const ITEM = "diamonds.whereditgo.bazaar.catalog.item";

async function freshDb(): Promise<Db> {
  const db = createDb(":memory:");
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}

function addProduct(db: Db, rkey: string, itemUris: string[] = []) {
  const uri = `at://${DID}/${PRODUCT}/${rkey}`;
  db.insert(catalogProducts)
    .values({
      uri,
      cid: `cid-product-${rkey}`,
      merchantDid: DID,
      title: `Product ${rkey}`,
      items: JSON.stringify(itemUris.map((u) => ({ uri: u }))),
    } as typeof catalogProducts.$inferInsert)
    .run();
  return uri;
}

function addItem(db: Db, rkey: string) {
  const uri = `at://${DID}/${ITEM}/${rkey}`;
  db.insert(catalogItems)
    .values({
      uri,
      cid: `cid-item-${rkey}`,
      merchantDid: DID,
      title: `Item ${rkey}`,
    } as typeof catalogItems.$inferInsert)
    .run();
  return uri;
}

/** A completed cover-art object attached to a product. */
function addCoverArt(
  db: Db,
  productUri: string,
  opts: {
    id: string;
    r2Key: string;
    webpR2Key?: string | null;
    contentType?: string | null;
    status?: string;
    position?: number;
  },
) {
  db.insert(inventoryUploadSession)
    .values({ id: `sess-${opts.id}`, merchantDid: DID } as typeof inventoryUploadSession.$inferInsert)
    .run();
  db.insert(inventoryUploadObject)
    .values({
      id: opts.id,
      sessionId: `sess-${opts.id}`,
      slotId: `slot-${opts.id}`,
      rkey: opts.id,
      role: "coverArt",
      fileName: "cover.png",
      contentType: opts.contentType ?? "image/png",
      status: opts.status ?? "completed",
      r2Key: opts.r2Key,
      webpR2Key: opts.webpR2Key ?? null,
    } as typeof inventoryUploadObject.$inferInsert)
    .run();
  db.insert(catalogProductAssets)
    .values({
      id: `asset-${opts.id}`,
      productUri,
      objectId: opts.id,
      role: "coverArt",
      position: opts.position ?? 0,
    } as typeof catalogProductAssets.$inferInsert)
    .run();
}

describe("resolveCoverProductUri", () => {
  test("resolves a product rkey to its own uri", async () => {
    const db = await freshDb();
    const uri = addProduct(db, "aaa");
    expect(resolveCoverProductUri(db, DID, "aaa")).toBe(uri);
  });

  test("a single borrows the owning product's art", async () => {
    const db = await freshDb();
    const itemUri = addItem(db, "bbb");
    const productUri = addProduct(db, "ccc", [itemUri]);
    expect(resolveCoverProductUri(db, DID, "bbb")).toBe(productUri);
  });

  test("an unowned single resolves to nothing", async () => {
    const db = await freshDb();
    addItem(db, "ddd");
    addProduct(db, "eee", []);
    expect(resolveCoverProductUri(db, DID, "ddd")).toBeNull();
  });

  test("an unknown rkey resolves to nothing", async () => {
    const db = await freshDb();
    expect(resolveCoverProductUri(db, DID, "nope")).toBeNull();
  });

  test("a non-did merchant resolves to nothing", async () => {
    const db = await freshDb();
    addProduct(db, "aaa");
    expect(resolveCoverProductUri(db, "", "aaa")).toBeNull();
  });
});

describe("resolveCoverArtObject", () => {
  test("prefers the webp derivative", async () => {
    const db = await freshDb();
    const uri = addProduct(db, "aaa");
    addCoverArt(db, uri, { id: "o1", r2Key: "orig/cover.png", webpR2Key: "webp/cover.webp" });
    expect(resolveCoverArtObject(db, uri)).toEqual({
      key: "webp/cover.webp",
      contentType: "image/webp",
    });
  });

  test("falls back to the original when no derivative exists", async () => {
    const db = await freshDb();
    const uri = addProduct(db, "aaa");
    addCoverArt(db, uri, { id: "o1", r2Key: "orig/cover.png", webpR2Key: null });
    expect(resolveCoverArtObject(db, uri)).toEqual({
      key: "orig/cover.png",
      contentType: "image/png",
    });
  });

  test("ignores an upload that never completed", async () => {
    const db = await freshDb();
    const uri = addProduct(db, "aaa");
    addCoverArt(db, uri, { id: "o1", r2Key: "orig/cover.png", status: "initiated" });
    expect(resolveCoverArtObject(db, uri)).toBeNull();
  });

  test("takes the first slideshow position", async () => {
    const db = await freshDb();
    const uri = addProduct(db, "aaa");
    addCoverArt(db, uri, { id: "o2", r2Key: "second.png", position: 1 });
    addCoverArt(db, uri, { id: "o1", r2Key: "first.png", position: 0 });
    expect(resolveCoverArtObject(db, uri)?.key).toBe("first.png");
  });

  test("a product with no art resolves to nothing", async () => {
    const db = await freshDb();
    const uri = addProduct(db, "aaa");
    expect(resolveCoverArtObject(db, uri)).toBeNull();
  });
});
