# GraphQL Conformance

**[View the dashboard](https://jbellenger.github.io/graphql-conformance/)**

## What is this?

This project tests whether open-source GraphQL implementations behave the same way. It runs the same queries against each implementation and compares the results to a reference ([graphql-js](https://github.com/graphql/graphql-js)).

Implementations tested:

- [graphql-js 17](https://github.com/graphql/graphql-js/tree/17.x.x) (reference)
- [graphql-js 16](https://github.com/graphql/graphql-js/tree/16.x.x)
- [graphql-java](https://github.com/graphql-java/graphql-java)
- [Viaduct](https://github.com/airbnb/viaduct)
- [Grafast](https://github.com/graphile/crystal/tree/main/grafast/grafast/)
- [graphql-go](https://github.com/graphql-go/graphql)
- [graphql-php](https://github.com/webonyx/graphql-php)
- [graphql-core](https://github.com/graphql-python/graphql-core)
- [gqlgen](https://github.com/99designs/gqlgen)
- [Hot Chocolate](https://github.com/ChilliCream/graphql-platform)
- [graphql-dotnet](https://github.com/graphql-dotnet/graphql-dotnet)
- [async-graphql](https://github.com/async-graphql/async-graphql)
- [Absinthe](https://github.com/absinthe-graphql/absinthe)
- [Juniper](https://github.com/graphql-rust/juniper)
- [graphql-ruby](https://github.com/rmosolgo/graphql-ruby)
- [Lacinia](https://github.com/walmartlabs/lacinia)

## How it works

Each implementation is wrapped in a small HTTP server that accepts a schema and query over `POST /execute`, builds the schema, runs the query, and returns the result as JSON. All harnesses use the same deterministic resolvers (the [Wiring Spec](SPEC.md)) so that the only differences come from the GraphQL engine itself.

Test cases are generated randomly using the [Viaduct Arbitrary toolkit]([https://github.com/airbnb/viaduct/tree/main/shared/arbitrary](https://github.com/airbnb/viaduct/tree/main/core/shared/arbitrary)). This produces arbitrary GraphQL schemas, documents, and variables, which are stored in [corpus](corpus).

A conformer runs every test case against the reference first. If the reference produces a result, the test is runnable and every implementation is compared against that result. If the reference crashes, times out, or emits invalid JSON, the test is excluded from scoring for that run and is not attempted on any other implementation.

## Results

Each run writes a timestamped summary to `results/data/runs/<run-id>/summary.json` and per-implementation non-pass results under `results/data/runs/<run-id>/results/<impl>.json`, plus `impls.json`, `runs.json`, and per-impl history shards. The on-disk layout mirrors the site's `Repository` types (`site/src/repository/types.ts`) — see [SPEC.md](SPEC.md) for the full shape. Everything in `results/data/` is committed to git so the dashboard has data to render.

`site/` is a Vite + React SPA. The `pages.yml` workflow builds the SPA with `npm ci && npm run build` inside `site/`, then copies `results/data/` into `site/dist/data/` (no translation — the shapes already match) and deploys `site/dist/` to GitHub Pages. Any commit that updates `results/data/` refreshes the dashboard automatically.

By default the conformer skips any conformant whose image digest + the corpus fingerprint haven't changed since the last run, reusing the prior results. Pass `--force` (i.e. `make run-conformer CONFORMER_ARGS=--force`) to re-run everything regardless.

### Daily runs

`.github/workflows/daily-conformance.yml` runs the full suite every day at 12:00 UTC (05:00 PDT / 04:00 PST) with `--force`, then commits the refreshed `results/data/` back to master — which triggers `pages.yml` to rebuild and redeploy the dashboard. Push authentication uses a GitHub App (`CONFORMANCE_APP_ID` + `CONFORMANCE_APP_SECRET_KEY` repo secrets) with `contents: write` on this repo, so commits land under a bot account rather than the default `github-actions[bot]`. This matters because GitHub pauses scheduled workflows after 60 days without a human-authored commit; the daily push keeps the schedule alive. Failures are surfaced through GitHub's native Actions failure emails; the same workflow can be kicked off manually from the Actions tab.

### Dependency updates

Library versions for every implementation are updated automatically by [Renovate](https://docs.renovatebot.com/). Configuration lives in `renovate.json` at the repo root. Renovate opens a PR for each available update and — if CI passes — the PR auto-merges with no human involvement. Most impls track the latest stable release from their native package manager; `graphql-js-17` tracks the latest stable 17.x release, while `graphql-js-16` is pinned to `<17`.

Installing the [Renovate GitHub App](https://github.com/apps/renovate) on the repo is a prerequisite. Branch protection must require CI success before auto-merge.

The version displayed next to each implementation on the dashboard is resolved at image build time (via `npm ls`, `mvn dependency:list`, `go list -m`, `cargo tree`, etc.) and written to `/impl-version` inside the image. The conformer reads that file over the Docker API — so there is no separate place in the repo where a version string is mirrored. See [SPEC.md](SPEC.md) for the driver-side contract.

## Requirements

- Docker 24+ with the `buildx` plugin

Docker Desktop ships `buildx` by default. On a plain Linux install, add it
with your package manager — the package name depends on which Docker you
installed:

- Ubuntu's `docker.io` (from the `universe` repo): `sudo apt install docker-buildx`
- Docker's official `docker-ce` (from [download.docker.com](https://docs.docker.com/engine/install/)): `sudo apt install docker-buildx-plugin`

All language runtimes, build tools, and system libraries live inside the
dev image.

## Quick start

```sh
make image          # build the dev image (first run only; slow)
make build          # clone libraries and build all implementations
make test           # run all tests
make run-conformer  # run conformance suite and update the dashboard
make serve-site     # serve the dashboard locally on http://localhost:8000
```

Every `make` target runs inside the container. Use `make shell` to drop into
a bash session when debugging a specific impl's build.

## Other commands

```sh
make gen-corpus                                        # regenerate test cases
make run-conformer CONFORMER_ARGS="--drivers graphql-go"   # run a subset of impls
make clean-corpus                                      # delete generated test cases (keeps corpus/0)
make clean-results                                     # delete stored results
make clean                                             # clean all build artifacts
```

## Project layout

```
corpus/           test cases (schema + query + optional variables)
corpus-gen/       test case generator (Kotlin)
conformer/        runs tests and compares results (Node.js)
impls/            one directory per GraphQL implementation
results/          results store (writes to results/data/)
site/             Vite + React SPA (dashboard); reads from bundled site/dist/data/
```

## Adding an implementation

1. Create `impls/<name>/` with a `Dockerfile` and a small HTTP server (`server.js`, `server.go`, …) that serves `GET /health` + `POST /execute` per the [Wiring Spec](SPEC.md)
2. Add `impls/<name>/manifest.json` declaring `image.build` and `runtime` fields
3. Add an entry to `registry.json` pointing at the manifest
4. If a new toolchain is required, add it to the top-level `Dockerfile`, then `make image` to rebake the dev image
5. Run `make run-conformer CONFORMER_ARGS="--drivers <name>"` to verify
