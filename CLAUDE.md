# GraphQL Conformance

Tests conformance of open-source GraphQL implementations against a reference (graphql-js).

See `SPEC.md` for the full specification.

## Quick Start

    cd conformer
    make build    # build all implementations
    make test     # run all tests (coordinator + all impls)
    make run      # run conformance tests, writes results.json

## Project Layout

All code lives under `conformer/`. The root only has `SPEC.md` and this file.

- `conformer/src/` — coordinator (Node.js): discovers corpus, spawns impl commands, compares results
- `conformer/impls/` — one directory per GraphQL implementation, each with its own Makefile
- `conformer/corpus/` — test cases (schema + query + optional variables per test)
- `conformer/config.json` — declares reference impl and conformants with their commands

## Key Conventions

- **Makefiles**: every impl has a `Makefile` with `build`, `test`, `clean` targets. The top-level Makefile recurses into each.
- **Commands**: each impl declares a `command` array in `config.json` (e.g. `["java", "-jar", "target/conformer-1.0.jar"]`). The coordinator spawns this directly with `cwd` set to the impl directory.
- **Testing**: each impl has wiring tests (native unit tests) and command tests (subprocess integration tests via node:test). Run everything with `make test` from `conformer/`.
- **Wiring Spec**: all impls return deterministic values based on type (Int→2, String→"str", etc.). See SPEC.md for the full spec.

## Adding an Implementation

1. Create `conformer/impls/<name>/` with native code implementing the Wiring Spec
2. Add a `Makefile` with `build`, `test`, `clean` targets
3. Add an entry to `conformer/config.json` with `name`, `path`, and `command`
4. Run `make build && make test` to verify
