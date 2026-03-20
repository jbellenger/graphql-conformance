# Absinthe Errata

This file records known conformance-relevant gaps in Absinthe as used by this harness.

## Directives

### 1. Custom executable directives are supported in macro-defined schemas

Absinthe supports custom query-time directives when they are defined with schema macros.

Evidence from upstream:
- `test/support/fixtures/strict_schema.ex` defines `directive :foo_bar_directive`.
- `test/absinthe/strict_schema_test.exs` executes queries using `@fooBarDirective(...)`.

This means custom directives are not inherently unsupported by Absinthe.

### 2. Custom type-system directives are supported for `import_sdl`, but through a prototype schema

Absinthe expects type-system directives used inside imported SDL to come from a prototype schema declared with `@prototype_schema`.

Evidence from upstream:
- `lib/absinthe/schema/prototype.ex` documents this pattern.
- `test/absinthe/schema/type_system_directive_test.exs` imports SDL that applies directives such as `@feature(...)` to schema/type-system nodes.

This path is supported and should not be treated as a conformance failure.

### 3. Executable directives declared in imported SDL are compiled, but not usable during document execution

Absinthe compiles directive definitions declared inside `import_sdl`, but does not fully wire those executable directives into query validation/execution.

Observed behavior on upstream `absinthe` commit `8e451950ea87083f50a06abf7b4246284bbe347d`:
- `import_sdl "directive @customQueryDirective on FIELD ..."` successfully compiles the directive into the schema.
- Query execution of `{ x @customQueryDirective }` still fails with `Unknown directive \`customQueryDirective\`.`.

This is a real library-level deviation in the `import_sdl` path, not a GraphQL-spec requirement to reject custom directives.

### 4. Built-in directive definitions can collide with Absinthe's preloaded built-ins

Absinthe preloads built-in directives such as `@include`, `@skip`, `@deprecated`, `@specifiedBy`, and `@oneOf`.

When SDL redeclares those same directives, the harness can hit duplicate-definition/import collisions even though the corpus is expressing standard GraphQL SDL.

Harness policy:
- only duplicate built-in directive definitions may be deduped before `import_sdl`
- arbitrary custom directives must not be removed

This dedupe is treated as host-library import normalization, not as conformance leniency.

### 5. Some corpus SDL files fail in Absinthe's SDL parser before directive semantics are reached

Several corpus schemas fail with:

`import_sdl could not parse SDL: syntax error before: ')'`

This happens in directive-heavy built-in SDL blocks before the harness's directive resolution logic runs.

This remains a separate parser limitation and should still count as an implementation failure unless a narrower, syntax-preserving workaround is justified.

## Harness Policy

The Absinthe harness should follow a minimal interop model:

- Never strip directive usages.
- Never strip arbitrary custom directive definitions.
- Preserve unknown-directive failures.
- Preserve placement, repeatability, argument-name, and argument-type validation.
- Only bridge missing wiring where Absinthe already has the directive definition but fails to connect it through `import_sdl`.
- Only dedupe duplicate built-in directive definitions that collide with Absinthe's preloaded built-ins.

In short:

- Bridge metadata and lookup.
- Do not invent directive behavior.
- Do not suppress genuine spec-visible failures.
