import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { merchantBusinessProfile } from "../db/schema";

const MAX_NAME = 200;
const MAX_STATE = 100;
const MAX_EMAIL = 320;

export type BusinessProfileFields = {
  businessName: string | null;
  businessState: string | null;
  businessEmail: string | null;
};

export function businessNameFromEnv(): string | null {
  const v = process.env.BUSINESS_NAME?.trim();
  return v && v.length > 0 ? v : null;
}

export function businessStateFromEnv(): string | null {
  const v = process.env.BUSINESS_STATE?.trim();
  return v && v.length > 0 ? v : null;
}

export function businessEmailFromEnv(): string | null {
  const v = process.env.BUSINESS_EMAIL?.trim();
  return v && v.length > 0 ? v : null;
}

export function getStoredBusinessProfile(db: Db): BusinessProfileFields {
  const row = db
    .select()
    .from(merchantBusinessProfile)
    .where(eq(merchantBusinessProfile.singleton, 1))
    .get();
  return {
    businessName: row?.businessName?.trim() || null,
    businessState: row?.businessState?.trim() || null,
    businessEmail: row?.businessEmail?.trim() || null,
  };
}

export function getEffectiveBusinessProfile(db: Db): BusinessProfileFields {
  const stored = getStoredBusinessProfile(db);
  return {
    businessName: businessNameFromEnv() ?? stored.businessName,
    businessState: businessStateFromEnv() ?? stored.businessState,
    businessEmail: businessEmailFromEnv() ?? stored.businessEmail,
  };
}

export function normalizeBusinessField(
  v: unknown,
): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

export function validateBusinessName(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > MAX_NAME) return "businessName exceeds max length";
  return null;
}

export function validateBusinessState(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > MAX_STATE) return "businessState exceeds max length";
  return null;
}

export function validateBusinessEmail(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > MAX_EMAIL) return "businessEmail exceeds max length";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "businessEmail is not a valid email address";
  }
  return null;
}
