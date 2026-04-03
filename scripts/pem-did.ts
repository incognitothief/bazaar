import { createPublicKey } from "node:crypto";

/** Bitcoin / multibase base58btc alphabet (no multiformats import — avoids package export issues). */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  let leading = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) leading++;
    else break;
  }
  const digits: string[] = [];
  let n2 = n;
  while (n2 > 0n) {
    const r = Number(n2 % 58n);
    n2 = n2 / 58n;
    digits.push(B58[r]!);
  }
  const body = digits.length > 0 ? digits.reverse().join("") : "";
  return B58[0]!.repeat(leading) + body;
}

/** P-256 SPKI PEM → multibase string (z…), matching multiformats base58btc.encode. */
export function publicPemToMultibase(pem: Buffer | string): string {
  const keyObject = createPublicKey(pem);
  const rawKey = keyObject.export({ type: "spki", format: "der" }) as Buffer;
  const uncompressedPoint = rawKey.subarray(-65);
  const prefixed = new Uint8Array(2 + uncompressedPoint.length);
  prefixed[0] = 0x12;
  prefixed[1] = 0x00;
  prefixed.set(uncompressedPoint, 2);
  return `z${b58encode(prefixed)}`;
}

export function publicPemToDidKey(pem: Buffer | string): string {
  return `did:key:${publicPemToMultibase(pem)}`;
}
