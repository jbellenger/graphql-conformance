This project tests "conformance" of a large number of open source graphql
implementations. 

# Corpus
Conformance is measured by using a corpus of GraphQL inputs.  An impl is
expected to be able to execute these inputs, and its result is compared to a
graphql reference implementation.

The input corpus is in ./conformer/corpus, and is organized like so:

For example:
./conformer/corpus/1                    # test-1
./conformer/corpus/1/schema.graphqls    # the schema for test-1
./conformer/corpus/1/1-query.graphql    # query 1 for test-1
./conformer/corpus/1/1-variables.json   # variables 1 for test-1
./conformer/corpus/1/2-query.graphql    # query 2 for test-1
./conformer/corpus/1/2-variables.json   # variables 2 for test-1

A special "0" test case (at ./conformer/corpus/0) is used by this framework to
sanity test each impl, independent of what the reference implementation
returns.

## Project Structure

The repo is rooted at the workspace root:

    Makefile              # top-level build orchestration
    registry.json         # driver registry
    conformer/src/        # conformer (Node.js)
      index.js            # entry point (orchestration)
      registry.js         # registry loader (in-tree + external)
      driver.js           # HTTP driver lifecycle
      docker.js           # dockerode wrapper (pull, build, run, stop)
      execute.js          # /execute HTTP request + multipart/mixed parsing
      corpus.js           # corpus discovery
      compare.js          # unordered-match
    corpus/               # test cases
      1/
        schema.graphqls
        1-query.graphql
        1-variables.json
    impls/                # implementations (Dockerfile + server + manifest.json each)
    results/              # ResultsStore module + data/ (gitignored)

## Build Environment

All tooling for the conformer itself (Node, Docker CLI, site build) runs
inside the dev container defined by the repo's `Dockerfile`. Driver images
are separate — each impl ships its own `Dockerfile` under `impls/<name>/`
that installs the target language runtime and GraphQL library.

Framework tools (always present inside the dev image): `node`, `make`, `git`,
`docker`.

### Top-level Makefile

The top-level `Makefile` orchestrates everything through the dev container:

    make image          # build the dev image
    make build          # install conformer deps + corpus generator
    make test           # run conformer and site unit tests
    make run-conformer  # run the conformer end-to-end (builds/pulls driver images on demand)
    make shell          # drop into a bash session in the container
    make clean          # clean conformer + corpus-gen build state

## Corpus Discovery

The conformer discovers test cases by:
1. Enumerating subdirectories of conformer/corpus/ — each subdirectory is a test (identified by its directory name)
2. Within each test directory, globbing for all files matching `*-query.graphql`
3. For each matched query file, extracting the prefix (the part before `-query.graphql`)
4. Looking for a corresponding `<prefix>-variables.json` file in the same directory
5. If the variables file is absent, the test case has no variables

Each test directory must contain a `schema.graphqls` file.

## Driver Contract (HTTP)

Each implementation is packaged as a Docker container exposing an HTTP API. The
conformer starts the container, polls readiness, sends one request per corpus test,
and tears the container down on completion.

### Endpoints

- **`GET /health`** — returns `200 OK` when the driver is ready to accept
  `/execute` requests. The conformer polls until `readinessTimeoutMs` is hit.

- **`POST /execute`** — core endpoint.

  Request (JSON):

      {
        "schema": "type Query { ... }",
        "query": "query Q { ... }",
        "variables": { "id": "1" },
        "operationName": "Q"
      }

  Response:
  - **Normal execution**: `Content-Type: application/json`, body is the standard
    GraphQL response `{ data, errors? }`.
  - **Incremental execution (`@defer`/`@stream`)**:
    `Content-Type: multipart/mixed; boundary=...` — GraphQL's official incremental
    delivery media type. The conformer parses parts and assembles the final
    result for comparison.
  - **Schema/parse/execute error** that would crash a library (e.g. stack
    overflow on circular input defaults, unsupported experimental directives):
    return HTTP `5xx`. The conformer treats this as a harness-level error —
    the test is excluded from scoring when the error comes from the reference
    driver.

### Manifest

Each driver ships `manifest.json` at the manifest path declared in `registry.json`:

    {
      "manifestVersion": 1,
      "name": "my-engine",
      "displayName": "My Engine",
      "homepage": "https://github.com/acme/my-engine",
      "versionUrlTemplate": "https://github.com/acme/my-engine/releases/tag/v{version}",
      "image": {
        "repository": "ghcr.io/acme/my-engine",
        "tag": "v1.2.3",
        "build": { "dockerfile": "./Dockerfile", "context": "." }
      },
      "runtime": {
        "port": 8080,
        "healthPath": "/health",
        "executePath": "/execute",
        "readinessTimeoutMs": 30000,
        "requestTimeoutMs": 30000,
        "env": {}
      }
    }

- `image.repository` (optional): fully-qualified image reference. The conformer
  pulls this first when present.
- `image.build` (optional): local build instructions used when
  `--build-from-source` is set or `repository` is absent.
- `runtime` defaults: port 8080, health `/health`, execute `/execute`, both
  timeouts 30 000 ms.
- `versionUrlTemplate` (optional): URL template used by the dashboard to link
  the displayed library version to an authoritative release or package page.
  The literal substring `{version}` is replaced (URL-encoded) with the version
  reported by the driver image (see *Library version reporting* below). Drivers
  MAY omit this; when absent, the version renders as plain text.

### Library version reporting

Each driver SHOULD emit its GraphQL library's logical release version so the
dashboard can display it. The version is reported through a file inside the
driver image:

- The driver's `Dockerfile` writes the version string to `/impl-version`,
  with no trailing newline expected (the conformer trims whitespace).
- The value SHOULD be resolved at image build time from the driver's package
  manager (e.g. `npm ls`, `require('<pkg>/package.json').version`,
  `go list -m`, `mvn dependency:list`, `cargo tree`, `dotnet list package`,
  `pip` / `importlib.metadata`). Using the resolved value — not a declaration
  from source (e.g. a caret range or wildcard) — ensures the dashboard reflects
  what was actually installed into the image.

The conformer reads `/impl-version` via the Docker API after pulling or
building each image and writes the value to `runs/<run-id>.json` as
`reference.version` and `conformants.<name>.version`.

Drivers MAY omit the file. When absent, `version` is recorded as `null`, the
dashboard displays `"unknown"` without a link, and all other harness behavior
(corpus execution, result storage) proceeds normally.

### Registry

`registry.json` at the repo root declares every endorsed driver:

    {
      "registryVersion": 1,
      "reference": "graphql-js-17",
      "drivers": [
        { "name": "graphql-js-17", "source": "in-tree",  "manifestPath": "./impls/graphql-js-17/manifest.json" },
        { "name": "my-engine",      "source": "external", "repoUrl": "https://github.com/acme/my-engine", "ref": "main", "manifestPath": "manifest.json" }
      ]
    }

- `reference` names the reference driver; swapping requires a one-field change.
- `source: "in-tree"` — manifest lives in this repo at `manifestPath`.
- `source: "external"` — the conformer clones `repoUrl@ref` into a scratch dir
  and reads `manifestPath` from the checkout.

Adding a driver is a PR against `registry.json`; merge = endorsement.

### CLI

The conformer entrypoint accepts:

- `--drivers <csv>` — run only the named drivers (reference is always included).
- `--exclude <csv>` — exclude named drivers.
- `--registry <path>` — override `registry.json` location.
- `--build-from-source` — force local build even if `repository` is set.
- `--image <ref>` — one-off: pin a single conformant image reference.
- `--corpus-dir <path>` — override corpus location.

## Execution Model

For each test case, the conformer runs the reference impl first.

- If the reference succeeds, the test is considered **runnable** for that run and
  all conformants are then run **in parallel** (each via a `POST /execute`
  request to its container).
- If the reference returns a 5xx, times out, or emits invalid JSON, the test is
  considered **excluded by reference** for that run. No conformant is run for that
  test, and the test does not count toward conformance totals.

Conformants have no dependencies on each other, so their execution order is
non-deterministic.

### Incremental runs

Before running tests, the conformer loads the most recent prior run from
`conformer/results/`. A conformant is **skipped** when all of these are true:

- The conformant exists in the prior run
- Its current image digest matches the prior run's image digest
- The reference image digest also matches the prior run's reference image digest
- The corpus fingerprint (sha256 of the sorted `testId/queryId` list) matches
  the prior run's fingerprint

The image digest is the content-addressed hash of the driver's Docker image —
distinct from the logical library version displayed on the dashboard. Two
different library versions always produce different image digests, but the
skip check compares digests because that is the content that actually gets
executed.

Skipped conformants reuse their test results from the prior run. If every
conformant is skipped, the prior run's runnable/excluded reference split is
also reused. This avoids re-executing unchanged implementations against the
same reference.

## Error Handling and Timeouts

- If the reference driver returns a 5xx response, does not respond within
  30 seconds, or emits an unparseable body, the test is excluded from scoring
  for that run.
- If a conformant driver returns a 5xx response, does not respond within
  30 seconds, or emits an unparseable body for a runnable reference case, that
  test is marked as a conformance failure for that conformant.

## Comparison

The conformer compares the response from each conformant impl against the
reference impl on runnable reference cases with a single step:

**Unordered match**: the responses are compared as JSON, ignoring object key
ordering but preserving array element order. `null` values are treated as
distinct from absent values. If the data matches under this comparison,
`matches` is `true`.

`compareResults` returns `{ matches: boolean }`.

## Results

The conformer writes results to `results/data/` in the Repository shape that
`site/src/repository/types.ts` describes — `Impl`, `Run`, `Result`,
`ImplRunResults`, `ImplHistoryPoint`. The site's `StaticJsonRepository` reads
these files directly; no build-time translation step.

`results/data/` is checked into git by the daily conformance workflow so the
GitHub Pages deploy has data to render. Tests must not write to or delete
from `results/data/` — use `ResultsStore.inMemory()` (`results/memory.js`) or
a temporary directory via the `RESULTS_DIR` env var.

### On-disk format

```
results/data/
  impls.json                                 # Impl[]
  runs.json                                  # Run[] (newest first)
  runs/
    <run-id>/
      summary.json                           # single Run + _conformerMeta
      results/
        <impl-id>.json                       # Result[] (non-pass only)
  impls/
    <impl-id>/
      history.json                           # ImplHistoryPoint[]
```

Files mirror site's types exactly; no field reshuffling between writer and
reader. The one exception is `_conformerMeta` on per-run `summary.json`: it
carries `corpusFingerprint`, `scoringModel`, and per-impl `imageDigest`/
`version` that the incremental-skip logic needs and the site ignores. It is
not copied into `runs.json`.

### ResultsStore API

```js
const { ResultsStore } = require('./results');

// Production: file-backed
const store = ResultsStore.fromDirectory('results/data');

// Tests: in-memory (same API, no disk I/O)
const testStore = ResultsStore.inMemory();

store.writeRun({ run, resultsByImpl, conformerMeta, impls });
//   run           — Run (resultsByImpl buckets with counts and empty results[])
//   resultsByImpl — Record<implId, Result[]>, non-pass only
//   conformerMeta — { corpusFingerprint, scoringModel, runnableCount, implMeta }
//   impls         — Impl[] (ordered; reference first)

store.listRuns();        // Run[] (newest first)
store.loadLatestRun();   // { run, resultsByImpl, conformerMeta } | null
store.loadRun(id);       // { run, resultsByImpl, conformerMeta } | null
```

The conformer respects a `RESULTS_DIR` environment variable to override the
default results location, used by integration tests to avoid touching
production data.

### Run ID format

Filesystem-safe ISO 8601: `2026-03-14T14-30-00Z` (colons replaced with hyphens).

### Per-run summary: `results/data/runs/<run-id>/summary.json`

```json
{
  "id": "2026-03-14T14-30-00Z",
  "timestamp": "2026-03-14T14:30:00Z",
  "referenceImplId": "graphql-js-17",
  "implIds": ["graphql-js-17", "graphql-java", "hot-chocolate"],
  "testCaseCount": 241,
  "resultsByImpl": {
    "graphql-js-17":  { "implId": "graphql-js-17",  "failed": 0,  "excluded": 9, "errored": 0, "results": [] },
    "graphql-java":   { "implId": "graphql-java",   "failed": 0,  "excluded": 0, "errored": 0, "results": [] },
    "hot-chocolate":  { "implId": "hot-chocolate",  "failed": 20, "excluded": 0, "errored": 4, "results": [] }
  },
  "_conformerMeta": {
    "corpusFingerprint": "e62fc5...",
    "scoringModel": "runnable-set-v1",
    "runnableCount": 232,
    "implMeta": {
      "graphql-js-17":  { "imageDigest": "sha256:...", "version": "17.0.0-alpha.14" },
      "graphql-java":   { "imageDigest": "sha256:...", "version": "25.0" },
      "hot-chocolate":  { "imageDigest": "sha256:...", "version": "15.1.15" }
    }
  }
}
```

`testCaseCount` is the full corpus denominator. For the reference impl,
`excluded` counts corpus cases where the reference could not produce an
expected output (5xx / timeout / unparseable / GraphQL errors). Those same
cases are also the ones not scored against any conformant.

For conformants, `failed` counts tests whose result diverged from the
reference, and `errored` counts tests where the driver itself errored
(timeout, crash, invalid JSON). Neither bucket contains reference-excluded
cases.

### Per-(run, impl) results shard: `results/data/runs/<run-id>/results/<impl-id>.json`

Non-pass `Result[]`. Passing tests are not stored; absence from this file
implies pass. Each record:

```json
{
  "id": "<uuid>",                       // deterministic: sha256(runId|implId|testCaseId)
  "runId": "<run-id>",
  "implId": "<impl-id>",
  "testCaseId": "<testId>/<queryId>",   // opaque composite; will normalize per U2
  "status": "fail" | "error" | "excluded",
  "expected": <unknown>,                // optional
  "actual":   <unknown>,                // optional
  "error":    "<string>",               // optional (harness / driver error)
  "stderr":   "<string>"                // optional
}
```

- `fail` — conformant data differs from reference (under unordered match).
- `error` — conformant driver errored (timeout/crash/unparseable output).
- `excluded` — reference could not produce expected output; only appears in
  the reference's own shard.

### Impls index: `results/data/impls.json`

Ordered `Impl[]` with reference first. Reference-ness is per-run (see
`Run.referenceImplId`), so `Impl` carries no `isReference` field. Derive as
`impl.id === run.referenceImplId`.

### Per-impl history: `results/data/impls/<impl-id>/history.json`

`ImplHistoryPoint[]`, newest first, derived from `runs.json`:

```json
[
  { "runId": "...", "timestamp": "...", "testCaseCount": 241, "failed": 24, "excluded": 0, "errored": 0 }
]
```

## Adding a New Implementation

New implementations should be added as HTTP drivers:

1. Create a directory under `impls/<name>/`.
2. Write a `Dockerfile` that installs the target language/runtime, builds the
   GraphQL library from its upstream source (pinned by tag/branch), and
   installs a thin HTTP server implementing the Wiring Spec.
3. Write the HTTP server (`server.js`, `server.go`, `server.py`, etc.). It must
   serve `GET /health` and `POST /execute` per the Driver Contract above.
4. Write `impls/<name>/manifest.json` declaring `image.build` (or `image.repository`)
   and `runtime` fields.
5. Add an entry to `registry.json` pointing at the manifest.

## Testing

Each implementation has native wiring tests (JUnit for Java, node:test for JS,
etc.) that verify the Wiring Spec behavior in-process: every scalar returns the
right value, unions resolve to the alphabetically first member, interfaces to
the last implementor, and so on. These tests run inside the driver image.

The conformer has unit tests for corpus discovery, registry loading, driver
lifecycle, and the deep-equality comparison, plus integration tests that
run through the full orchestration path using stub session factories
(self-comparison, skip invalidation, reference exclusions).

All tests run via `make test` from the repo root.

## Wiring Spec

Each implementation will wire its schema such that:
- every Int field returns 2
- every Float field returns 3.14
- every String field returns "str"
- every Boolean field returns true
- every ID field returns "id"
- every custom scalar field returns "str"
- every nullable field is returned as non-null
- every union is resolved as the lexicographically first member type
- every interface is resolved as the lexicographically last implementing type
- every list field returns exactly 2 items
- every enum field returns its first declared value
- queries may include `@defer` and `@stream`. Drivers that natively support
  incremental delivery MUST emit a standards-compliant
  `Content-Type: multipart/mixed; boundary=...` response (see §HTTP driver
  contract). The conformer parses the parts and merges them into one final
  `{ data, errors?, extensions? }` object before comparison. Conformance is
  defined against that collapsed value. Drivers without native support MUST
  still accept schemas that declare `@defer`/`@stream` (registering stub
  directive definitions as needed) and MAY execute synchronously, returning a
  single `application/json` body that reflects the full selection set. After
  collapse, the Wiring Spec values above still apply (e.g. a list field under
  `@stream(initialCount: 0)` must yield exactly two items).
