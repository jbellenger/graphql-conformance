// Single source of truth for this project's GitHub location. Anything
// constructing a URL that points at the repo (header link, per-test-case
// corpus links, manifest permalinks on the dashboard) should import from
// here rather than open-coding its own copy, so a rename / fork / move is
// a one-line edit.
export const REPO_URL = 'https://github.com/jbellenger/graphql-conformance';

// Helper: `https://github.com/<owner>/<repo>/blob/<ref>/<path>`.
// `ref` defaults to `master` — the branch the site deploys from.
export function repoBlobUrl(relativePath: string, ref = 'master'): string {
  const cleanPath = relativePath.replace(/^\//, '');
  return `${REPO_URL}/blob/${ref}/${cleanPath}`;
}
