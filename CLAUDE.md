# GraphQL Conformance

Tests conformance of open-source GraphQL implementations against a reference (graphql-js).

See `SPEC.md` for the full specification.

## Quick Start

    make build          # check tools, install via mise if needed, build all implementations
    make test           # run all tests
    make run-conformer  # run conformance tests and update site/data

## Project Layout

The repo root contains the top-level Makefile, `config.json`, `SPEC.md`, and this file.

- `conformer/src/` — coordinator (Node.js): discovers corpus, spawns impl commands, compares results
- `impls/` — one directory per GraphQL implementation, each with its own Makefile
- `corpus/` — test cases (schema + query + optional variables per test)
- `config.json` — declares the reference impl and conformants with their commands

## Key Conventions

- **Makefiles**: every impl has a `Makefile` with `build`, `test`, `clean` targets. The top-level Makefile recurses into each.
- **Commands**: each impl declares a `command` array in `config.json` (e.g. `["java", "-jar", "target/conformer-1.0.jar"]`). The coordinator spawns this directly with `cwd` set to the impl directory.
- **Testing**: each impl has wiring tests (native unit tests) and command tests (subprocess integration tests via node:test). Run everything with `make test` from the repo root.
- **Wiring Spec**: all impls return deterministic values based on type (Int→2, String→"str", etc.). See SPEC.md for the full spec.

## Adding an Implementation

1. Create `impls/<name>/` with native code implementing the Wiring Spec
2. Add a `Makefile` with `build`, `test`, `clean` targets
3. Add an entry to `config.json` with `name`, `path`, `command`, and `tools`
4. Add required tool versions to `.mise.toml` if not already present
5. Run `make build && make test` to verify
