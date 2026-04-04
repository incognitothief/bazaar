import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { storefrontWebOrigin } from "./oauth-url";

const KEYS = ["PUBLIC_WEB_APP_URL", "PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS"] as const;

describe("storefrontWebOrigin", () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("downgrades https on loopback to http (Vite dev)", () => {
    process.env.PUBLIC_WEB_APP_URL = "https://127.0.0.1:5173";
    delete process.env.PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS;
    expect(storefrontWebOrigin()).toBe("http://127.0.0.1:5173");
  });

  test("keeps https on loopback when PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS=true", () => {
    process.env.PUBLIC_WEB_APP_URL = "https://127.0.0.1:5173";
    process.env.PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS = "true";
    expect(storefrontWebOrigin()).toBe("https://127.0.0.1:5173");
  });

  test("does not change https for non-loopback hosts", () => {
    process.env.PUBLIC_WEB_APP_URL = "https://store.example.com";
    delete process.env.PUBLIC_WEB_APP_URL_ALLOW_LOOPBACK_HTTPS;
    expect(storefrontWebOrigin()).toBe("https://store.example.com");
  });
});
