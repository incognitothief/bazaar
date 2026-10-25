const UPSTREAM_SOURCE_URL = "https://github.com/incognitothief/bazaar";

/**
 * Where the "Source Code" footer link points.
 *
 * Bazaar is MIT licensed, so this link is a courtesy rather than an obligation. Upstream's
 * URL only describes an unmodified deployment; anyone running modified code who wants the
 * link to show their own changes sets `VITE_SOURCE_URL` to their repository at build time.
 *
 * Both variables are optional. Unset, the link resolves to upstream, which is never broken.
 *
 * `VITE_SOURCE_COMMIT` is appended as a commit path when set, so the link resolves to the
 * exact running revision rather than whatever the default branch happens to be. It is only
 * appended for hosts where the path shape is known (GitHub, GitLab, Codeberg/Gitea);
 * otherwise the base URL is used unchanged.
 */
export function sourceCodeUrl(): string {
  const base =
    import.meta.env.VITE_SOURCE_URL?.trim().replace(/\/+$/, "") ||
    UPSTREAM_SOURCE_URL;
  const commit = import.meta.env.VITE_SOURCE_COMMIT?.trim() ?? "";

  if (!/^[0-9a-f]{7,40}$/i.test(commit)) return base;

  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    // Not a URL we can parse — hand back whatever was configured rather than guessing.
    return base;
  }

  // github.com and Gitea/Codeberg use /commit/<sha>; GitLab uses /-/commit/<sha>.
  if (host === "gitlab.com") return `${base}/-/commit/${commit}`;
  if (host === "github.com" || host === "codeberg.org")
    return `${base}/commit/${commit}`;

  return base;
}
