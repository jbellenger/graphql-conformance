# GraphQL Conformance

Tests conformance of open-source GraphQL implementations against a reference (graphql-js).

See `SPEC.md` for the full specification.

## Quick Start

Everything runs inside the dev container defined by `Dockerfile`. The
top-level `Makefile` wraps `docker run` so `make` works as usual.

    make image          # build the dev image (first run only)
    make build          # build all implementations
    make test           # run all tests
    make run-conformer  # run conformance tests and update site/data
    make shell          # drop into a bash session in the container

## Project Layout

The repo root contains the top-level Makefile, `registry.json`, `SPEC.md`, and this file.

- `conformer/src/` — conformer (Node.js): discovers corpus, orchestrates drivers, compares results
- `impls/` — one directory per GraphQL implementation (HTTP driver packaging lives here)
- `corpus/` — test cases (schema + query + optional variables per test)
- `registry.json` — endorsed driver list (in-tree + external); single source of truth for which driver is the reference

## Key Conventions

- **Driver model**: each driver ships a `manifest.json` + `Dockerfile` + `server.{js,go,py,...}` under `impls/<name>/`. The conformer builds/pulls the image, starts a container, polls `/health`, and sends `POST /execute` per test.
- **Testing**: each impl has wiring tests (native unit tests) that run inside its driver image. The conformer has unit + integration tests (integration uses stub session factories to avoid spinning up Docker). Run everything with `make test` from the repo root.
- **Wiring Spec**: all impls return deterministic values based on type (Int→2, String→"str", etc.). See SPEC.md for the full spec.

## Adding an Implementation

1. Create `impls/<name>/` with a `Dockerfile` that builds the toolchain + library, and a small HTTP server (`server.js`, `server.go`, etc.) that serves `GET /health` + `POST /execute` per the HTTP contract in SPEC.md.
2. Add `impls/<name>/manifest.json` declaring `image.build` and `runtime` fields.
3. Add an entry to `registry.json` pointing at the manifest.
4. Run `make run-conformer --drivers <name>` to verify.
