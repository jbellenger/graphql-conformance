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

### 5. Valid directive definitions can fail to parse because directive-location atoms must already exist in the VM

Absinthe's parser converts directive locations in directive definitions using `binary_to_existing_atom/2` in `src/absinthe_parser.yrl`.

Observed behavior on upstream `absinthe` commit `8e451950ea87083f50a06abf7b4246284bbe347d`:
- valid SDL such as `directive @x on FRAGMENT_SPREAD` can fail during parsing with `not an already existing atom`
- the failure depends on VM state; if a module has already loaded atoms such as `:fragment_spread` or `:input_field_definition`, the same SDL can parse successfully
- this affects standard built-in executable/type-system directive locations such as `FRAGMENT_DEFINITION`, `FRAGMENT_SPREAD`, `INLINE_FRAGMENT`, `OBJECT`, and `INPUT_FIELD_DEFINITION`

Important clarification:
- multiline directive argument definitions are allowed by the GraphQL spec
- Absinthe does parse multiline directive argument lists, including per-argument descriptions, when the directive uses a location such as `FIELD`
- the corpus failure is therefore not a multiline-formatting issue; it is a parser bug in directive-location atom conversion

Harness policy:
- do not "prime" the VM with these atoms as a silent workaround
- treat this as a real parser defect in Absinthe's SDL handling

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
