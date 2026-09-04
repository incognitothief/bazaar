/**
 * Best-effort webp derivative for a cover image, via Bun's native Image
 * API (Bun 1.4+, no npm dependency, no WASM to ship -- see the commit that
 * bumped Bun for why). Caps the long edge for storefront display; the
 * original file is untouched and is what the product download package
 * always serves -- this derivative exists purely for web display.
 *
 * Returns null if the source isn't a decodable image (e.g. a non-image
 * file that happens to share the same upload role) or encoding otherwise
 * fails. Callers must treat this as optional and never block the actual
 * upload on it succeeding -- a missing derivative just means the read
 * path falls back to serving the original.
 */
const MAX_DIMENSION = 1600;

export async function generateWebpDerivative(
  bytes: Uint8Array | Buffer,
): Promise<Uint8Array | null> {
  try {
    const img = new Bun.Image(bytes);
    const resized = img.resize(MAX_DIMENSION);
    return await resized.webp().bytes();
  } catch {
    return null;
  }
}
