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
    registry.json         # driver registry (primary)
    config.json           # legacy subprocess configuration (deprecated)
    conformer/src/        # conformer (Node.js)
      index.js            # entry point (orchestration)
      registry.js         # registry loader (in-tree + external)
      driver.js           # HTTP driver lifecycle
      docker.js           # dockerode wrapper (pull, build, run, stop)
      execute.js          # /execute HTTP request + multipart/mixed parsing
      corpus.js           # corpus discovery
      compare.js          # unordered-match + quirk detection
      runner.js           # legacy subprocess runner (deprecated)
      protocol.js         # legacy conformer-stream-v1 parser (deprecated)
    corpus/               # test cases
      1/
        schema.graphqls
        1-query.graphql
        1-variables.json
    impls/                # implementations
      graphql-js-17/      # HTTP driver (Dockerfile + server.js + manifest.json)
      graphql-js-16/      # HTTP driver
      graphql-java/       # legacy subprocess impl (Makefile + index.js)
      ...
    results/              # ResultsStore module + data/ (gitignored)

## Build Environment

All builds run inside the dev container defined by the repo's `Dockerfile`. The
image ships every language runtime, build tool, and system dependency needed by
any impl — there is no host setup beyond Docker. Toolchain
versions are pinned directly in the `Dockerfile`; bumping a version and running
`make image` rebakes the image.

Framework tools (always present inside the image): `node`, `make`, `git`.

Each implementation declares its additional tool requirements in `config.json`
via the `tools` field. The conformer checks that the required tools are on
PATH before building.

## Build System

Build orchestration is handled by the Node.js conformer (`src/builder.js`), not by
individual impl Makefiles. The conformer clones repos, fetches latest code, checks out
the configured branch, manages stamp files, and invokes `make build` in each impl
directory — all in parallel with error tolerance.

### How it works

Each impl in `config.json` declares a `repo` (git URL), `branch`, and `tools` (required
build tools). When `make build` is run, the conformer:

1. Checks all required tools are on PATH inside the container
2. Clones `repo` into `<impl-dir>/build/` if not already cloned
3. Runs `git fetch --all` to get latest from remote
4. Checks out `origin/<branch>` (detached HEAD at latest remote tip)
5. Compares HEAD SHA to `.built-sha` stamp — skips build if they match
6. Runs `make build` in the impl directory (5-minute timeout by default; overrideable per impl)
7. Writes the SHA to `.built-sha` on success

Builds run in parallel (bounded by CPU count). A failed build is reported but does
not block other impls from building.

### Impl Makefiles

Each impl's `Makefile` has `build`, `test`, and `clean` targets. The `build` target
assumes `build/` already exists with the source checked out — it only needs to handle
the ecosystem-specific compile step (e.g. `npm install`, `mvn package`, `gradlew build`).

The `build/` directory is gitignored per impl.

### Version reporting

The conformer reads each impl's version directly via `git rev-parse HEAD` in the
`build/` directory. There is no `version` Makefile target.

### Top-level Makefile

The top-level `Makefile` orchestrates everything through the dev container:

    make image          # build the dev image
    make build          # build all impls (parallel, error-tolerant)
    make test           # run conformer unit tests and each impl's tests
    make run-conformer  # run the conformer end-to-end
    make shell          # drop into a bash session in the container
    make clean          # clean all impls

## Configuration

The conformer reads `registry.json` at the repo root (format described under
"Registry" in the Driver Contract section below). If `registry.json` is absent,
the conformer falls back to `config.json` for one release and logs a deprecation.

### Legacy `config.json` format

    {
      "reference": "graphql-js-17",
      "impls": {
        "graphql-js-17": {
          "path": "./impls/graphql-js-17",
          "repo": "https://github.com/graphql/graphql-js.git",
          "branch": "17.x.x",
          "command": ["node", "index.js"]
        },
        "graphql-java": {
          "path": "./impls/graphql-java",
          "repo": "https://github.com/graphql-java/graphql-java.git",
          "branch": "master",
          "command": ["java", "-jar", "target/conformer-1.0.jar"]
        }
      }
    }

Each impl entry has:
- `path`: directory containing the impl, relative to the repo root
- `repo`: git URL for the library's source repository
- `branch`: which branch to track (must be explicit)
- `command`: array of command + args to execute the impl as a subprocess
- `tools`: optional array of tool names required to build and run the impl
- `buildTimeoutMs`: optional override for build timeout in milliseconds

Multiple impls can point at the same repo on different branches, e.g. to test
both `main` and a release branch.

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
    return HTTP `5xx`. The conformer treats this as a harness-level error
    analogous to a subprocess crash — the test is excluded from scoring when
    the error comes from the reference driver.

### Manifest

Each driver ships `manifest.json` at the manifest path declared in `registry.json`:

    {
      "manifestVersion": 1,
      "name": "my-engine",
      "displayName": "My Engine",
      "homepage": "https://github.com/acme/my-engine",
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
- `--config <path>` — legacy: use a `config.json` directly (deprecated).
- `--build-from-source` — force local build even if `repository` is set.
- `--image <ref>` — one-off: pin a single conformant image reference.
- `--corpus-dir <path>` — override corpus location.

## Legacy Command Interface (subprocess, deprecated)

Impls that have not yet migrated to the HTTP driver model fall back to the
subprocess contract declared in `config.json`. The conformer detects this by the
absence of a `manifest.json` at the registry entry's path and spawns:

    <command...> <absolute-path-to-schema> <absolute-path-to-query> [<absolute-path-to-variables>]

The variables argument is omitted when no variables file exists for a test case.

The command must:
1. Read the schema file and build a GraphQL schema using the Wiring Spec below. The
   schema may use custom root type names via `schema { query: MyRoot }` — implementations
   must not assume the query root type is named `Query` (likewise for `Mutation` and
   `Subscription`).
2. Parse and execute the query (with variables if provided). Queries may include
   `@defer` and `@stream`.
3. Print either:
   - a single GraphQL result as JSON to stdout, or
   - a line-delimited conformer incremental protocol stream on stdout

   Harnesses must not emit HTTP multipart framing or transport-specific streamed
   output. If the underlying library supports incremental delivery, the harness
   should translate native incremental payloads into the conformer protocol and
   let the conformer normalize them.
4. Exit with code 0 on success

### Conformer incremental protocol

For incremental execution, a harness may emit one JSON object per line using
protocol `conformer-stream-v1`.

- `{"protocol":"conformer-stream-v1","kind":"initial", ... }`
- `{"protocol":"conformer-stream-v1","kind":"patch", ... }`
- `{"protocol":"conformer-stream-v1","kind":"complete", ... }`

Rules:

- `initial` must be the first event
- `complete` must be the final event
- `patch.path` is absolute from the GraphQL response root
- `patch.data` represents a deferred object patch
- `patch.items` represents streamed list items
- harnesses should translate library-specific pending IDs / subpaths into this
  absolute-path form rather than merging patches themselves

For example, the graphql-js reference implementation runs `node index.js` which
loads the schema, wires it, executes the query, and prints the result. The
graphql-java implementation runs `java -jar target/conformer-1.0.jar` which
does the equivalent in Java.

Before running tests, the conformer reads each impl's version via `git rev-parse HEAD`
in the `<impl-dir>/build/` directory.

## Execution Model

For each test case, the conformer runs the reference impl first.

- If the reference succeeds, the test is considered **runnable** for that run and
  all conformants are then run **in parallel** (each as an independent subprocess).
- If the reference crashes, times out, or emits invalid JSON, the test is
  considered **excluded by reference** for that run. No conformant is run for that
  test, and the test does not count toward conformance totals.

Conformants have no dependencies on each other, so their execution order is
non-deterministic.

### Incremental runs

Before running tests, the conformer loads the most recent prior run from
`conformer/results/`. A conformant is **skipped** when all of these are true:

- The conformant exists in the prior run
- Its current SHA matches the prior run's SHA
- The reference SHA also matches the prior run's reference SHA
- The corpus fingerprint (sha256 of the sorted `testId/queryId` list) matches
  the prior run's fingerprint

Skipped conformants reuse their test results from the prior run. If every
conformant is skipped, the prior run's runnable/excluded reference split is
also reused. This avoids re-executing unchanged implementations against the
same reference.

## Error Handling and Timeouts

- If the reference command exits with a non-zero exit code, does not complete
  within 30 seconds, or produces output that is not valid JSON, the test is
  excluded from scoring for that run.
- If a conformant command exits with a non-zero exit code, does not complete
  within 30 seconds, or produces output that is not valid JSON for a runnable
  reference case, that test is marked as a conformance failure for that conformant.

## Comparison

The conformer compares the response from each conformant impl against the
reference impl on runnable reference cases in two steps:

1. **Unordered match**: the responses are compared as JSON, ignoring object key ordering
   but preserving array element order. `null` values are treated as distinct from absent
   values. If the data matches under this comparison, `matches` is `true`.

2. **Quirk detection**: if `matches` is `true`, the conformer checks for SHOULD-level
   spec deviations (called "quirks") by comparing the original ordered responses.

Each test result is an object `{ "matches": <bool>, "quirks": [<string>, ...] }`.
Quirks are stored alongside failures in `results/data/quirks/<impl>/<runId>.json`
(failures-only model: tests with no quirks are omitted).

### Known quirks

| Quirk | Spec reference | Detected when |
|-------|---------------|---------------|
| `"object-ordering"` | §7.2.2 Serialized Map Ordering, §3.6 Field Ordering | Conformant response keys diverge from the reference's ordered response at any object level |

## Results

The conformer writes results to `results/data/` using a failures-only storage model
(passing tests are not stored; absence from the failures file means pass). The
`ResultsStore` class (`results/index.js`) provides a read/write API over this data.

**`results/data/` is semi-sacred.** External systems (dashboards, links) may reference
specific run IDs. Deleting or modifying this data constitutes a breaking change. Tests
must never write to or delete from `results/data/` — use `MemoryResultsStore`
(`results/memory.js`) or a temporary directory with `RESULTS_DIR` env var instead.

### On-disk format

```
results/data/
  runs/
    <run-id>.json              # run metadata + per-conformant summary
  failures/
    <conformant-name>/
      <run-id>.json            # array of failing test keys
```

### ResultsStore API

```js
const { ResultsStore } = require('./results');

// Production: file-backed
const store = ResultsStore.fromDirectory('results/data');

// Tests: in-memory (same API, no disk I/O)
const testStore = ResultsStore.inMemory();

store.recordRun(runResult);       // write a run
store.listRuns();                 // [{id, timestamp, reference}]
store.getSummary();               // [{impl, passPct, total, failed, lastRun, sha}]
store.getImplHistory(name);       // [{date, passPct, total, failed}]
store.getReferenceHistory();      // [{date, passPct, total, failed, excluded, corpusTotal}]
store.getImplFailures(name);      // [{testKey, error|expected|actual|stderr}]
store.getReferenceExclusions();   // [{testKey, error, stderr}]
store.getTestStatus(testKey);     // [{impl, passes}]
store.loadLatestRunSummary();     // latest run metadata + failure-only summaries
```

The conformer respects a `RESULTS_DIR` environment variable to override the default
results location, used by integration tests to avoid touching production data.

### Run ID format

Filesystem-safe ISO 8601: `2026-03-14T14-30-00Z` (colons replaced with hyphens).

### Per-run file: `conformer/results/<run-id>.json`

    {
      "id": "2026-03-14T14-30-00Z",
      "timestamp": "2026-03-14T14:30:00Z",
      "reference": {
        "name": "graphql-js",
        "sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        "corpusTotal": 241,
        "total": 232,
        "errors": 0,
        "excluded": 9
      },
      "conformants": {
        "graphql-java": {
          "sha": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5",
          "tests": {
            "0.1": { "matches": true, "quirks": [] },
            "1.1": { "matches": true, "quirks": ["object-ordering"] }
          }
        }
      }
    }

`reference.total` is the runnable-set denominator for that run. `reference.excluded`
counts the corpus cases that were skipped because the reference did not produce a
result.

Each conformant entry includes the library SHA and a `tests` object. The keys use
dotted notation `<testId>.<queryId>` (e.g. `"1.1"` for test directory 1, query prefix
1). Each maps to an object with:
- `matches` (boolean): `true` if the response data matches the reference, ignoring
  object key ordering
- `quirks` (list of strings): observed SHOULD-level spec deviations (see Comparison)

### Index file: `conformer/results/index.json`

    {
      "runs": [
        { "id": "2026-03-14T14-30-00Z", "timestamp": "2026-03-14T14:30:00Z" },
        { "id": "2026-03-13T10-00-00Z", "timestamp": "2026-03-13T10:00:00Z" }
      ]
    }

Newest first. A dashboard can load this index and then fetch individual run files.

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

Legacy subprocess wrappers (`index.js` / `Makefile` under `impls/<name>/`) remain
supported during the migration phase but are deprecated. Their `Makefile` targets
(`build`, `test`, `clean`) do not manage their own ordering; the outer conformer
orchestrates the lifecycle.

## Testing

Each implementation has two layers of tests:

1. **Wiring tests** — native unit tests (JUnit for Java, node:test for JS) that verify
   the Wiring Spec behavior in-process: every scalar returns the right value, unions
   resolve to the alphabetically first member, interfaces to the last implementor, etc.

2. **Command tests** — subprocess integration tests (node:test) that invoke the impl's
   command with small test schemas and verify the JSON output matches expectations.

The conformer itself has unit tests for corpus discovery, the subprocess runner,
and the deep-equality comparison, plus an integration test that runs graphql-js
against itself (self-comparison must produce all `true`).

All tests run via `make test` from the `conformer/` directory.

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
- queries may include `@defer` and `@stream`, but execution for this framework is
  always synchronous: the implementation must produce one final JSON result rather
  than incremental patches or streamed payloads
