import { repoBlobUrl } from './repo';

// The testCaseId is a hash-addressed slash-path: `<schemaId>/<queryId>` or
// `<schemaId>/<queryId>/<variablesId>`. Maps to these corpus files:
//   corpus/<schemaId>/schema.graphqls
//   corpus/<schemaId>/<queryId>/query.graphql
//   corpus/<schemaId>/<queryId>/<variablesId>/variables.json
export interface CorpusPaths {
  schemaPath: string;
  queryPath: string;
  variablesPath: string | null;
}

export function corpusPathsForTestCase(testCaseId: string): CorpusPaths | null {
  const parts = testCaseId.split('/');
  if (parts.length < 2) return null;
  const [schemaId, queryId, variablesId] = parts;
  return {
    schemaPath: `corpus/${schemaId}/schema.graphqls`,
    queryPath: `corpus/${schemaId}/${queryId}/query.graphql`,
    variablesPath: variablesId
      ? `corpus/${schemaId}/${queryId}/${variablesId}/variables.json`
      : null,
  };
}

export interface CorpusArtifact {
  // Repo-relative path, e.g. `corpus/aa/schema.graphqls`.
  path: string;
  // Permalink to the file on GitHub (for the "view source" link).
  blobUrl: string;
  text: string;
}

export interface CorpusArtifacts {
  schema: CorpusArtifact;
  query: CorpusArtifact;
  variables: CorpusArtifact | null;
}

// `path` is the repo-relative corpus path. The runtime fetches from
// `${dataBaseUrl}${path}` — e.g. `/data/corpus/aa/schema.graphqls` — which
// resolves to the copy shipped by `_build-site` (or served by the vite dev
// middleware). The GitHub blob URL is attached for the inline "view source"
// link and intentionally tracks `master` to match the FailureCard behavior.
async function loadOne(
  path: string,
  dataBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<CorpusArtifact> {
  const url = `${dataBaseUrl}${path}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${path}: ${res.status} ${res.statusText}`,
    );
  }
  const text = await res.text();
  return { path, blobUrl: repoBlobUrl(path), text };
}

// Fetch the schema, query, and (optional) variables text for a test case.
// `dataBaseUrl` is prepended to each repo-relative corpus path; it must end
// with a slash. In-app callers use the site's BASE_URL + "data/"; tests pass
// a fake prefix with a stub fetch.
export async function loadCorpusArtifacts(
  testCaseId: string,
  dataBaseUrl: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<CorpusArtifacts | null> {
  const paths = corpusPathsForTestCase(testCaseId);
  if (!paths) return null;
  const [schema, query, variables] = await Promise.all([
    loadOne(paths.schemaPath, dataBaseUrl, fetchImpl),
    loadOne(paths.queryPath, dataBaseUrl, fetchImpl),
    paths.variablesPath
      ? loadOne(paths.variablesPath, dataBaseUrl, fetchImpl)
      : Promise.resolve(null),
  ]);
  return { schema, query, variables };
}
