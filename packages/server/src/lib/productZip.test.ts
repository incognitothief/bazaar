import { describe, expect, it } from "bun:test";
import {
  checkProductZipCap,
  entitlementMatchesCurrentItems,
  isAlreadyZipFile,
  MAX_PRODUCT_ZIP_TOTAL_BYTES,
  passthroughExistingZip,
  shouldStoreZipMember,
} from "./productZip";

function productWithItems(uris: string[]) {
  return { items: JSON.stringify(uris.map((uri) => ({ uri, cid: "bafycid" }))) };
}

describe("entitlementMatchesCurrentItems", () => {
  it("is true for a legacy receipt (no frozen grant)", () => {
    expect(
      entitlementMatchesCurrentItems(productWithItems(["at://a/x/1"]), undefined),
    ).toBe(true);
  });

  it("is true when the grant covers exactly the current items, any order", () => {
    const product = productWithItems(["at://a/x/1", "at://a/x/2"]);
    expect(
      entitlementMatchesCurrentItems(product, ["at://a/x/2", "at://a/x/1"]),
    ).toBe(true);
  });

  it("is false when an item was removed from the product since the purchase", () => {
    const product = productWithItems(["at://a/x/1"]);
    expect(
      entitlementMatchesCurrentItems(product, ["at://a/x/1", "at://a/x/2"]),
    ).toBe(false);
  });

  it("is false when an item was added to the product since the purchase", () => {
    const product = productWithItems(["at://a/x/1", "at://a/x/2"]);
    expect(entitlementMatchesCurrentItems(product, ["at://a/x/1"])).toBe(false);
  });
});

describe("checkProductZipCap", () => {
  it("is ok when completed objects sum under the cap", () => {
    expect(
      checkProductZipCap([
        { status: "completed", byteSize: 10 * 1024 * 1024 },
        { status: "completed", byteSize: 20 * 1024 * 1024 },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects when completed objects sum over the cap", () => {
    expect(
      checkProductZipCap([
        { status: "completed", byteSize: MAX_PRODUCT_ZIP_TOTAL_BYTES },
        { status: "completed", byteSize: 1 },
      ]),
    ).toEqual({ error: "package_too_large", status: 413 });
  });

  it("rejects when there are no completed objects", () => {
    expect(checkProductZipCap([])).toEqual({
      error: "no_downloadable_files",
      status: 400,
    });
    expect(
      checkProductZipCap([{ status: "initiated", byteSize: 50 * 1024 * 1024 }]),
    ).toEqual({ error: "no_downloadable_files", status: 400 });
  });

  it("ignores incomplete objects when summing", () => {
    expect(
      checkProductZipCap([
        { status: "completed", byteSize: 10 },
        { status: "initiated", byteSize: MAX_PRODUCT_ZIP_TOTAL_BYTES },
        { status: "failed", byteSize: MAX_PRODUCT_ZIP_TOTAL_BYTES },
      ]),
    ).toEqual({ ok: true });
  });

  it("uses only the entitled subset's sizes, not the full product", () => {
    const full = [
      { status: "completed", byteSize: MAX_PRODUCT_ZIP_TOTAL_BYTES - 1 },
      { status: "completed", byteSize: MAX_PRODUCT_ZIP_TOTAL_BYTES - 1 },
    ];
    expect(checkProductZipCap(full)).toEqual({
      error: "package_too_large",
      status: 413,
    });
    expect(checkProductZipCap(full.slice(0, 1))).toEqual({ ok: true });
  });

  it("treats null byteSize on a completed object as 0", () => {
    expect(
      checkProductZipCap([
        { status: "completed", byteSize: null },
        { status: "completed", byteSize: 12 },
      ]),
    ).toEqual({ ok: true });
  });
});

describe("passthroughExistingZip", () => {
  it("passes through a single completed zip", () => {
    const obj = {
      status: "completed",
      fileName: "2023-5 recap.zip",
      contentType: "application/zip",
    };
    expect(passthroughExistingZip([obj])).toEqual(obj);
  });

  it("recognizes zip by extension even without contentType", () => {
    expect(isAlreadyZipFile("pack.ZIP", null)).toBe(true);
    expect(
      passthroughExistingZip([{ status: "completed", fileName: "a.ZIP" }]),
    ).not.toBeNull();
  });

  it("does not passthrough a single non-zip file", () => {
    expect(
      passthroughExistingZip([
        { status: "completed", fileName: "master.flac", contentType: "audio/flac" },
      ]),
    ).toBeNull();
  });

  it("does not passthrough a zip plus another packaged file", () => {
    expect(
      passthroughExistingZip([
        { status: "completed", fileName: "release.zip" },
        { status: "completed", fileName: "cover.jpg" },
      ]),
    ).toBeNull();
  });

  it("ignores incomplete objects when deciding passthrough", () => {
    const zip = { status: "completed", fileName: "release.zip" };
    expect(
      passthroughExistingZip([
        zip,
        { status: "initiated", fileName: "notes.pdf" },
      ]),
    ).toEqual(zip);
  });
});

describe("shouldStoreZipMember", () => {
  it("stores typical already-compressed delivery formats", () => {
    expect(shouldStoreZipMember("film.mp4", "video/mp4")).toBe(true);
    expect(shouldStoreZipMember("clip.mov", null)).toBe(true);
    expect(shouldStoreZipMember("track.mp3", "audio/mpeg")).toBe(true);
    expect(shouldStoreZipMember("track.flac", null)).toBe(true);
    expect(shouldStoreZipMember("cover.jpg", "image/jpeg")).toBe(true);
    expect(shouldStoreZipMember("notes.pdf", null)).toBe(true);
    expect(shouldStoreZipMember("bundle.zip", null)).toBe(true);
  });

  it("deflates uncompressed masters", () => {
    expect(shouldStoreZipMember("master.wav", "audio/wav")).toBe(false);
    expect(shouldStoreZipMember("scan.tiff", "image/tiff")).toBe(false);
    expect(shouldStoreZipMember("liner.txt", "text/plain")).toBe(false);
    expect(shouldStoreZipMember("data.csv", null)).toBe(false);
  });
});
