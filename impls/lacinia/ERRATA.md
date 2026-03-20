# Lacinia Errata

This file records known conformance-relevant gaps in Lacinia as used by this harness.

Notes below were verified against upstream `lacinia` commit `f7eba1044fb42dbd16533cbb029929367b25801a`.

## Directives

### 1. `repeatable` is supported in Lacinia's internal directive model, but not in SDL parsing

Lacinia does support repeatable directives once they are present in its internal schema representation:
- `src/com/walmartlabs/lacinia/schema.clj` validates repeatability via `:repeatable`
- `src/com/walmartlabs/lacinia/introspection.clj` exposes directive `isRepeatable`
- `test/com/walmartlabs/lacinia/custom_directive_test.clj` includes tests for repeatable directives in programmatic schemas

However, the SDL parser does not recognize the `repeatable` keyword in directive definitions:
- `resources/com/walmartlabs/lacinia/GraphqlSchema.g4` defines `directiveDef` as `directive @name args? on locations`
- `src/com/walmartlabs/lacinia/parser/schema.clj` transforms SDL directive definitions into `{:locations ... :args ...}` and never captures a repeatable flag

Observed behavior:
- valid SDL such as `directive @x repeatable on FIELD_DEFINITION` fails during schema parsing
- corpus schemas that declare repeatable directives fail before execution begins

This is best understood as a front-end SDL gap, not a missing internal directive feature.

### 2. `VARIABLE_DEFINITION` is not supported as a directive location

Lacinia does not currently support `VARIABLE_DEFINITION` as a directive location in any of the main entry points relevant to this harness.

Evidence from upstream:
- `resources/com/walmartlabs/lacinia/GraphqlSchema.g4` omits `VARIABLE_DEFINITION` from the allowed SDL directive locations
- `src/com/walmartlabs/lacinia/schema.clj` omits `:variable-definition` from the `::location` spec accepted by `schema/compile`
- `resources/com/walmartlabs/lacinia/Graphql.g4` defines `variableDefinition` as `variable ':' type defaultValue?` and does not allow directives
- `src/com/walmartlabs/lacinia/parser/query.clj` captures only variable name, type, and default value for query variable definitions

Observed behavior:
- SDL directive definitions that mention `VARIABLE_DEFINITION` fail during schema parsing
- even programmatic `schema/compile` rejects directive defs with location `:variable-definition`
- query documents cannot place directives on variable definitions in Lacinia's query grammar

This is a real unsupported surface area, not just an SDL parser omission.

## Corpus Impact

These gaps are exercised by the generated conformance corpus:
- repeatable directive definitions appear in multiple corpus schemas
- `VARIABLE_DEFINITION` appears in multiple corpus directive-location lists

As a result, some corpus cases fail at schema-parse time before resolver wiring or query execution can begin.
