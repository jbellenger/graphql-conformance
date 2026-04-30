defmodule ConformerAbsintheTest do
  use ExUnit.Case, async: false

  defp exec(sdl, query, variables \\ nil) do
    ConformerAbsinthe.run(sdl, query, variables)
  end

  describe "Wiring Spec — scalars" do
    test "Int field returns 2" do
      assert %{data: %{"x" => 2}} = exec("type Query { x: Int }", "{ x }")
    end

    test "Float field returns 3.14" do
      assert %{data: %{"x" => 3.14}} = exec("type Query { x: Float }", "{ x }")
    end

    test "String field returns \"str\"" do
      assert %{data: %{"x" => "str"}} = exec("type Query { x: String }", "{ x }")
    end

    test "Boolean field returns true" do
      assert %{data: %{"x" => true}} = exec("type Query { x: Boolean }", "{ x }")
    end

    test "ID field returns \"id\"" do
      assert %{data: %{"x" => "id"}} = exec("type Query { x: ID }", "{ x }")
    end

    test "custom scalar field returns \"str\"" do
      sdl = "scalar DateTime type Query { x: DateTime }"
      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end
  end

  describe "Wiring Spec — nullability and wrappers" do
    test "nullable field is returned as non-null" do
      assert %{data: %{"x" => "str"}} = exec("type Query { x: String }", "{ x }")
    end

    test "non-null wrapper does not change the value" do
      assert %{data: %{"x" => "str"}} = exec("type Query { x: String! }", "{ x }")
    end
  end

  describe "Wiring Spec — lists" do
    test "list field returns exactly 2 items" do
      assert %{data: %{"x" => ["str", "str"]}} =
               exec("type Query { x: [String] }", "{ x }")
    end

    test "nested list of objects returns 2 items" do
      sdl = "type Item { name: String } type Query { items: [Item] }"

      assert %{data: %{"items" => [%{"name" => "str"}, %{"name" => "str"}]}} =
               exec(sdl, "{ items { name } }")
    end

    test "list of list returns 2x2 items" do
      assert %{data: %{"x" => [["str", "str"], ["str", "str"]]}} =
               exec("type Query { x: [[String]] }", "{ x }")
    end
  end

  describe "Wiring Spec — enums, unions, interfaces" do
    test "enum field returns first declared value" do
      sdl = "enum Color { RED GREEN BLUE } type Query { x: Color }"
      assert %{data: %{"x" => "RED"}} = exec(sdl, "{ x }")
    end

    test "union resolves to lexicographically first member" do
      sdl = """
      type Dog { bark: String }
      type Cat { meow: String }
      union Pet = Dog | Cat
      type Query { x: Pet }
      """

      query = "{ x { ... on Cat { meow } ... on Dog { bark } } }"
      assert %{data: %{"x" => %{"meow" => "str"}}} = exec(sdl, query)
    end

    test "interface resolves to lexicographically last implementor" do
      sdl = """
      interface Node { id: ID }
      type Alpha implements Node { id: ID a: Int }
      type Zeta implements Node { id: ID z: Int }
      type Query { x: Node }
      """

      query = "{ x { id ... on Alpha { a } ... on Zeta { z } } }"
      assert %{data: %{"x" => %{"id" => "id", "z" => 2}}} = exec(sdl, query)
    end
  end

  describe "@defer / @stream directive declarations" do
    # SPEC.md: "Drivers without native support MUST still accept schemas that
    # declare @defer/@stream (registering stub directive definitions as needed)
    # and MAY execute synchronously."
    test "accepts a schema that redeclares @defer with descriptions on directive and arguments" do
      sdl = """
      schema { query: Q }

      "This directive allows results to be deferred during execution"
      directive @defer(
          "Deferred behaviour is controlled by this argument"
          if: Boolean! = true,
          "A unique label that represents the fragment being deferred"
          label: String
        ) on FRAGMENT_SPREAD | INLINE_FRAGMENT

      type Q { x: String }
      """

      # Regression: prior to fix, take_directive_definition reversed the
      # @defer block and import_sdl failed with "syntax error before: ')'".
      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end

    test "accepts a query using @defer on a fragment spread" do
      sdl = """
      schema { query: Q }

      directive @defer(
          if: Boolean! = true,
          label: String
        ) on FRAGMENT_SPREAD | INLINE_FRAGMENT

      type Q { a: String b: String }
      """

      query = """
      query { ...F @defer(if: false, label: "") }
      fragment F on Q { a b }
      """

      # Absinthe has no native incremental delivery. Per SPEC, synchronous
      # execution reflecting the full selection set is acceptable.
      assert %{data: %{"a" => "str", "b" => "str"}} = exec(sdl, query)
    end

    test "accepts a schema that redeclares @experimental_disableErrorPropagation" do
      sdl = """
      schema { query: Q }

      "This directive disables error propagation when a non nullable field returns null for the given operation."
      directive @experimental_disableErrorPropagation on QUERY | MUTATION | SUBSCRIPTION

      type Q { x: String }
      """

      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end
  end

  describe "built-in directive redeclarations" do
    # Absinthe preloads @include/@skip/@deprecated/@specifiedBy/@oneOf. The
    # corpus redeclares them in SDL; the driver strips the duplicates before
    # passing to import_sdl.
    test "tolerates redeclared @include with description and default" do
      sdl = """
      schema { query: Q }

      "Directs the executor to include this field or fragment only when the `if` argument is true"
      directive @include(
          "Included when true."
          if: Boolean!
        ) on FIELD | FRAGMENT_SPREAD | INLINE_FRAGMENT

      type Q { x: String }
      """

      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end

    test "tolerates redeclared @deprecated with description and default" do
      sdl = """
      schema { query: Q }

      "Marks the field, argument, input field or enum value as deprecated"
      directive @deprecated(
          "The reason for the deprecation"
          reason: String! = "No longer supported"
        ) on FIELD_DEFINITION | ARGUMENT_DEFINITION | ENUM_VALUE | INPUT_FIELD_DEFINITION

      type Q { x: String @deprecated(reason: "old") y: String }
      """

      assert %{data: %{"x" => "str", "y" => "str"}} = exec(sdl, "{ x y }")
    end

    test "tolerates redeclared @oneOf" do
      sdl = """
      schema { query: Q }

      "Indicates an Input Object is a OneOf Input Object."
      directive @oneOf on INPUT_OBJECT

      type Q { x: String }
      """

      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end
  end

  describe "custom user directive definitions" do
    # Regression: multi-line user directive definitions with leading
    # descriptions must round-trip through the sanitizer in original order.
    # Prior to fix, the block emerged reversed and import_sdl rejected it.
    test "preserves a multi-line user directive with description and arg descriptions" do
      sdl = """
      schema { query: Q }

      "A user-defined directive"
      directive @Custom(
          "The first argument"
          a: String,
          "The second argument"
          b: Int = 7
        ) on FIELD_DEFINITION | ARGUMENT_DEFINITION

      type Q { x: String }
      """

      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end

    test "preserves a single-line user directive definition" do
      sdl = """
      schema { query: Q }

      directive @Simple on FIELD_DEFINITION

      type Q { x: String }
      """

      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end

    test "preserves multiple user directives alongside built-in redeclarations" do
      sdl = """
      schema { query: Q }

      directive @First on FIELD_DEFINITION

      "A multi-line user directive"
      directive @Second(
          "arg description"
          x: Int = 1
        ) on FIELD_DEFINITION

      directive @include(
          "Included when true."
          if: Boolean!
        ) on FIELD | FRAGMENT_SPREAD | INLINE_FRAGMENT

      directive @Third on OBJECT

      type Q { x: String }
      """

      assert %{data: %{"x" => "str"}} = exec(sdl, "{ x }")
    end
  end

  describe "variables" do
    test "passes scalar variables to execution" do
      sdl = "type Q { x: String } schema { query: Q }"
      query = "query($skip: Boolean!) { x @skip(if: $skip) }"

      # when skipped, field is absent
      assert %{data: data} = exec(sdl, query, %{"skip" => true})
      refute Map.has_key?(data, "x")

      assert %{data: %{"x" => "str"}} = exec(sdl, query, %{"skip" => false})
    end
  end
end
