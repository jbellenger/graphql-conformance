# GraphQL Conformance

**[View the dashboard](https://jbellenger.github.io/graphql-conformance/)**

## What is this?

This project tests whether open-source GraphQL implementations behave the same way. It runs the same queries against each implementation and compares the results to a reference ([graphql-js](https://github.com/graphql/graphql-js)).

Implementations tested:

- [graphql-js 16](https://github.com/graphql/graphql-js/tree/16.x.x) (reference)
- [graphql-js 17](https://github.com/graphql/graphql-js/tree/17.x.x)
- [graphql-java](https://github.com/graphql-java/graphql-java)
- [Viaduct](https://github.com/airbnb/viaduct)
- [graphql-go](https://github.com/graphql-go/graphql)
- [graphql-php](https://github.com/webonyx/graphql-php)
- [graphql-core](https://github.com/graphql-python/graphql-core)
- [gqlgen](https://github.com/99designs/gqlgen)
- [Hot Chocolate](https://github.com/ChilliCream/graphql-platform)
- [graphql-dotnet](https://github.com/graphql-dotnet/graphql-dotnet)
- [async-graphql](https://github.com/async-graphql/async-graphql)
- [Absinthe](https://github.com/absinthe-graphql/absinthe)
- [Juniper](https://github.com/graphql-rust/juniper)

## How it works

Each implementation is wrapped in a small harness that accepts a schema file and a query file, builds the schema, runs the query, and prints the result as JSON. All harnesses use the same deterministic resolvers (the [Wiring Spec](SPEC.md)) so that the only differences come from the GraphQL engine itself.

Test cases are generated randomly using the [Viaduct Arbitrary toolkit](https://github.com/airbnb/viaduct/tree/main/shared/arbitrary). This produces arbitrary GraphQL schemas, documents, and variables, which are stored in [corpus](corpus).

A coordinator runs every test case against every implementation, compares outputs to the reference, and records the results.

## Requirements

- [mise](https://mise.jdx.dev/) — manages tool versions (Node.js, Go, Java, .NET, Rust, Python)

That's it. `mise` handles installing the right versions of everything else.
On macOS, `mise install php` may require a newer `bison` on `PATH` than the system default.

## Quick start

```sh
make build          # clone libraries and build all implementations
make test           # run all tests
make run-conformer  # run conformance suite and update the dashboard
make serve-site     # serve the dashboard locally
```

## Other commands

```sh
make gen-corpus                                        # regenerate test cases
make run-impl IMPL=graphql-go TEST=corpus/0/0          # run one impl on one test
make diff-impl IMPL=graphql-go TEST=corpus/0/0         # diff an impl against the reference
make clean-corpus                                      # delete generated test cases (keeps corpus/0)
make clean-results                                     # delete stored results
make clean                                             # clean all build artifacts
```

## Project layout

```
corpus/           test cases (schema + query + optional variables)
corpus-gen/       test case generator (Kotlin)
conformer/        coordinator that runs tests and compares results (Node.js)
impls/            one directory per GraphQL implementation
results/          results store (writes to results/data/)
site/             static dashboard (reads from site/data/)
```

## Adding an implementation

1. Create `impls/<name>/` with code that implements the [Wiring Spec](SPEC.md)
2. Add a `Makefile` with `build`, `test`, `clean` targets
3. Add an entry to `config.json`
4. Add any new tool versions to `.mise.toml`
5. Run `make build && make test`
