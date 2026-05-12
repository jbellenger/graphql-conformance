# Conformance Harness TODOs

## Critical (ship-blockers)

- [x] **graphql-js-17**: `package.json:7` pins `"graphql": "^16.13.1"`; `npm install --install-links build` does not override a fixed version, so the "reference" harness actually executes against graphql-js v16. Change to `"graphql": "file:./build"` (or drop the version specifier).
- [x] **graphql-java** (`src/.../Main.java:115-158`): `ConformanceWiringFactory` does not register custom scalars in `RuntimeWiring`. Schemas containing `scalar DateTime` (etc.) throw `SchemaProblem` before execution. Register custom scalar type mappings before schema generation.
- [x] **graphql-java**: Parser rejects `@defer` / `@stream`. Enable directives or provide stub implementations per spec ("allowed but synchronous — emit ONE final JSON").
- [x] **hot-chocolate** (`Program.cs:121`): `AddDocumentFromString(schemaText)` ignores `schema { query: Foo }`. Parse the schema AST for `SchemaDefinitionNode` and wire custom root type names.
- [x] **hot-chocolate**: No try/catch anywhere — unhandled exceptions crash with no diagnostic output. Wrap main logic, write error to stderr, exit 1.
- [x] **async-graphql**: `Cargo.toml:4` has `edition = "2024"` (invalid). Change to `"2021"`.
- [x] **async-graphql** (`src/main.rs:17-20`): Nullable-to-non-null logic inverted — nullable SDL types returned as nullable, so fields resolve to null. Wrap all nullable types in `NonNull` regardless of SDL.
- [x] **juniper** (`src/main.rs:293`): `convert_type` wraps named types as `Type::nullable`, so nullable fields return null instead of wired values. Strip the nullable wrapping — spec requires non-null.
- [x] **viaduct** (`Makefile:12`): `clean` removes the upstream `build/` directory checked out by the conformer. Target only `target/`, `.built-sha`, and `dependency-reduced-pom.xml`.
- [x] **all other impls: `clean` removes conformer-managed `build/`**: same bug class as viaduct. Affects `graphql-dotnet:10`, `graphql-js-17:11`, `grafast:11`, `juniper:11`, `lacinia:13`, `graphql-core:12`, `graphql-java:12`, `graphql-js-16:11`, `graphql-ruby:13`, `graphql-php:11`, `gqlgen:12`, `graphql-go:12`, `hot-chocolate:10`, `async-graphql:11`. Drop `build` from each `clean` rm list; keep per-impl artifacts (`target/`, `node_modules/`, `bin/`, `obj/`, etc.) and `.built-sha`.
- [x] **graphql-ruby** (`Makefile:9`): `test: build` violates the "test must not depend on build" convention. Remove the dependency.
- [x] **graphql-ruby** (`index.rb:30`): `ctx.query.get_type(typename)` uses deprecated API. Change to `ctx.schema.get_type(typename)`.
- [x] **conformer** (`compare.js`, `results/index.js`): Quirks are unimplemented. `SPEC.md:253-271` specifies `{matches, quirks}` with `"object-ordering"` detected when conformant keys diverge from query order. `grep quirks conformer/src` returns zero. Either implement detection in `compareResults` and propagate through `ResultsStore`, or drop quirks from SPEC.
- [x] **conformer** (`index.js:66-80, 149-154`): Skip predicate ignores corpus changes. Regenerating the corpus without touching impl code produces stale results for every unchanged conformant; if all are skipped, the prior `corpusTotal`/`total` split is copied forward even though the corpus has grown. Fingerprint the corpus (or invalidate on any mtime change) in the skip predicate.

## Moderate

- [x] **graphql-core** (`index.py:156-164`): No exception handling; raw Python tracebacks leak on malformed input. Wrap schema/query/variables loading in try/except, write to stderr, exit 1.
- [x] **grafast** (`index.js:195`): Streaming path can exit without emitting `complete` when the iterator finishes before `hasNext === false`. Always emit `complete` after the loop in streaming mode.
- [x] **graphql-go** (`main.go:259, 274`): Unchecked `[0]` / `[len-1]` indexing on union/interface members — panics on empty sets. Add `len(...) > 0` guards.
- [x] **gqlgen**: No `@defer` / `@stream` handling; directives silently treated as regular fields. Detect in selection-set resolver, collect deferred/streamed fields, emit final response.
- [x] **graphql-dotnet** (`Conformer.csproj:15`): `PackageReference Version="*"` unversioned wildcard — pin for reproducibility (e.g., `Version="8.3.*"`).
- [x] **hot-chocolate** (`Conformer.csproj:15`): `PackageReference Version="*"` unversioned wildcard — pin for reproducibility and to make dependency updates manageable by Renovate.
- [x] **graphql-dotnet** (`Program.cs:26`): No try/catch around `Parser.Parse` / `ExecuteAsync`. Wrap, exit 1 on failure.
- [ ] **absinthe** (`lib/conformer.ex:189-196`): `prime_identifier_atoms/1` violates the project's own `ERRATA.md` policy ("do not 'prime' the VM with these atoms as a silent workaround"). Either remove or document the deliberate policy override.
- [x] **absinthe** (`index.exs:19`): `{:ok, result} =` pattern-match crashes on `{:error, ...}`. Handle both branches.
- [x] **graphql-php** (`conformer-harness.test.js`): Code appears to support custom root types but no test exercises `schema { query: Foo }`. Add test.
- [x] **lacinia**: Parse errors propagate as raw Clojure exceptions — no JSON error wrapping. Add try/catch in harness entry point.
- [ ] **conformer** (`protocol.js:74-78` vs `159-164`): Streaming results normalize away empty `errors`/`extensions`, legacy `JSON.parse` output doesn't. A legacy reference emitting `{data, errors:[]}` fails to match a streaming conformant that dropped the empty list. Normalize both paths symmetrically.
- [ ] **conformer** (`diff-impl.js:86`): Always exits 1 after writing diff output, regardless of `spawnSync('diff', ...).status`. If `diff` itself fails we still report "differences found". Propagate the actual status.
- [ ] **conformer** (`index.js:13-16`): `generateRunId()` emits ISO timestamps at millisecond precision. Two runs within the same millisecond collide and the second overwrites the first, causing flaky failures in `integration.test.js:140` (`second run skips unchanged conformant and reuses prior failures`) when `assert.equal(runs.length, 2)` sees 1. Add a monotonic counter suffix or sub-millisecond precision.

## Test-coverage gaps (cross-cutting)

- [ ] Add custom-root-type test (`schema { query: Foo }`) to: **hot-chocolate, graphql-dotnet, graphql-php, async-graphql, juniper**.
- [ ] Add nullable-field wiring test (field declared nullable must return the wired value, not null) to **all** harnesses. This gap is what let the juniper and async-graphql nullability bugs slip through.
- [ ] Document `@defer` / `@stream` support matrix (rejects / ignores / streams / translates / synchronous) across impls.
- [ ] Add direct unit tests for `impl-cli.js::parseCorpusTestPath` (path-escape, 2-part vs 3-part paths, `..` variants) and `resolveImpl` (unknown impl error-shape). Currently only covered transitively via `run-impl.test.js`.
- [ ] Add tests for `check.js` and `build.js` (missing-tool warning vs exit behavior, build-failure output tail). Neither has any direct coverage today.
- [ ] Add an integration test exercising corpus-change-during-skip (tied to the conformer Critical item above).
- [ ] Add a test firing an actual build timeout (currently only `getBuildTimeoutMs` config plumbing is covered).
- [ ] Add a test covering mixed streaming + legacy conformants with empty `errors:[]` to pin behavior (or the fix, once applied).
- [ ] Add a `compareResults` test for `null` data (both sides, one side only).

## Minor / code quality

- [x] **graphql-js-17** (`index.js:63`): Error message references `"conformer-harness.js"` but entry point is `index.js`. Fix text.
- [x] **async-graphql** (`src/main.rs:91-94`): Four full `.clone()` calls per object field yield O(schema²) allocations. Use `Arc<>` or pass by reference.
- [x] **async-graphql** (`src/main.rs:220-225`): `.expect()` on file reads panics with unstructured output. Replace with structured error handling.
- [x] **juniper**: Replace `expect()` panics on schema errors (`src/main.rs:80, 89, 379-384`) with graceful error messages.
- [x] **viaduct**: `NoOpCoercing` defined twice (`ViaductHarness.kt:111-117` and `ViaductHarnessTest.kt:148-154`). Deduplicate.
- [ ] **absinthe**: Add `@doc` / `@spec` to public functions in `Conformer` and `DirectiveSupport`.
- [ ] **absinthe** (`lib/conformer.ex:307-328`): Regex-based directive-definition parsing is brittle (breaks on descriptions with escaped quotes). Replace with AST-based detection.
- [x] **conformer** (`index.js:122-126`): Dead-code reconstruction of `conformantTests[name]` for skipped conformants — removed in the writer rewrite.
- [x] **conformer** (`index.js:181`): Tautology `refPct` — removed in the writer rewrite.
- [x] **conformer** (`compare.js:60-78`): Dead `deepEqual` pre-pass — removed along with `sameKeyOrder` / quirks.
- [x] **conformer** (`results/index.js:210-212`): `loadLatestRun` / `loadLatestRunSummary` alias — collapsed to a single `loadLatestRun` in the writer rewrite.
- [ ] **conformer** (`builder.js:56-58`): `git checkout` runs before the stamp check. On stamp hits this wastes a checkout; move the stamp check up.
- [ ] **conformer** (`tools.js:32`): `erlang: [executable, '-version']` returns empty output on modern OTP, so `getVersion` silently reports `'unknown'` even when Erlang is installed.
- [ ] **conformer** (`build.js` vs `check.js`): `build.js` warns on missing tools and proceeds; `check.js` exits non-zero. Align behavior.
- [ ] **conformer** (`impl-cli.js:32`): `relative.startsWith('..')` also rejects a directory literally named `..foo`. Replace with `relative === '..' || relative.startsWith('..' + path.sep)`.
