defmodule ConformerAbsinthe do
  # Absinthe preloads these built-ins already. When the corpus redeclares them in SDL,
  # we normalize that import-time collision but keep all custom directives intact.
  @duplicate_built_in_directive_definitions MapSet.new([
                                              "include",
                                              "skip",
                                              "deprecated",
                                              "specifiedBy",
                                              "oneOf"
                                            ])

  def run(schema_text, query_text, variables \\ nil) do
    prime_identifier_atoms(schema_text)
    prime_identifier_atoms(query_text)

    {schema_sdl, metadata} = prepare_schema(schema_text)
    schema_module = build_schema_module(schema_sdl, metadata)

    {:ok, result} =
      Absinthe.run(query_text, schema_module,
        variables: variables,
        # Absinthe.run/3 does not automatically apply schema pipeline modifiers
        # to the document pipeline, so we forward the schema's modifier chain here.
        pipeline_modifier: fn pipeline, options ->
          Absinthe.Schema.apply_modifiers(pipeline, schema_module, options)
        end
      )

    result
  end

  def resolve_field(_parent, _args, resolution) do
    {:ok, resolve_value(resolution.definition.schema_node.type, resolution.schema)}
  end

  def resolve_abstract_type(%{__conformer_type_name: type_name}, _resolution), do: type_name
  def resolve_abstract_type(_, _resolution), do: nil

  defp prepare_schema(schema_text) do
    {:ok, blueprint} = Absinthe.Phase.Parse.run(schema_text, [])
    definitions = blueprint.input.definitions

    sanitized_schema =
      drop_directive_definitions(schema_text, @duplicate_built_in_directive_definitions)

    {sanitized_schema, build_metadata(definitions)}
  end

  defp build_schema_module(schema_sdl, metadata) do
    schema_module =
      Module.concat([
        ConformerAbsinthe.DynamicSchema,
        :"Schema#{System.unique_integer([:positive, :monotonic])}"
      ])

    Code.compile_quoted(
      quote do
        defmodule unquote(schema_module) do
          use Absinthe.Schema

          @pipeline_modifier ConformerAbsinthe.DirectiveSupport
          @conformer_metadata unquote(Macro.escape(metadata))
          def __conformer_metadata__, do: @conformer_metadata

          import_sdl(unquote(schema_sdl))

          def hydrate(%Absinthe.Blueprint.Schema.FieldDefinition{identifier: :__typename}, _),
            do: []

          def hydrate(%Absinthe.Blueprint.Schema.FieldDefinition{}, _),
            do: [resolve: &ConformerAbsinthe.resolve_field/3]

          def hydrate(%Absinthe.Blueprint.Schema.InterfaceTypeDefinition{}, _),
            do: [resolve_type: &ConformerAbsinthe.resolve_abstract_type/2]

          def hydrate(%Absinthe.Blueprint.Schema.UnionTypeDefinition{}, _),
            do: [resolve_type: &ConformerAbsinthe.resolve_abstract_type/2]

          def hydrate(_, _), do: []
        end
      end
    )

    schema_module
  end

  defp build_metadata(definitions) do
    enum_first =
      for %Absinthe.Language.EnumTypeDefinition{name: name, values: [first | _]} <- definitions,
          into: %{} do
        {identifier(name), identifier(first.value)}
      end

    union_first =
      for %Absinthe.Language.UnionTypeDefinition{name: name, types: members} <- definitions,
          into: %{} do
        first_member =
          members
          |> Enum.map(& &1.name)
          |> Enum.sort()
          |> List.first()
          |> identifier()

        {identifier(name), first_member}
      end

    interface_last =
      definitions
      |> Enum.reduce(%{}, fn
        %Absinthe.Language.ObjectTypeDefinition{name: name, interfaces: interfaces}, acc ->
          Enum.reduce(interfaces, acc, fn interface, inner_acc ->
            Map.update(inner_acc, interface.name, [name], &[name | &1])
          end)

        _, acc ->
          acc
      end)
      |> Map.new(fn {interface_name, implementors} ->
        last_implementor =
          implementors
          |> Enum.sort()
          |> List.last()
          |> identifier()

        {identifier(interface_name), last_implementor}
      end)

    %{
      enum_first: enum_first,
      union_first: union_first,
      interface_last: interface_last
    }
  end

  defp resolve_value(%Absinthe.Type.NonNull{of_type: inner}, schema) do
    resolve_value(inner, schema)
  end

  defp resolve_value(%Absinthe.Type.List{of_type: inner}, schema) do
    [resolve_value(inner, schema), resolve_value(inner, schema)]
  end

  defp resolve_value(type_identifier, schema) when is_atom(type_identifier) do
    type = Absinthe.Schema.lookup_type(schema, type_identifier)
    metadata = schema.__conformer_metadata__()

    case type do
      %Absinthe.Type.Scalar{identifier: :integer} ->
        2

      %Absinthe.Type.Scalar{identifier: :float} ->
        3.14

      %Absinthe.Type.Scalar{identifier: :string} ->
        "str"

      %Absinthe.Type.Scalar{identifier: :boolean} ->
        true

      %Absinthe.Type.Scalar{identifier: :id} ->
        "id"

      %Absinthe.Type.Scalar{} ->
        "str"

      %Absinthe.Type.Enum{} ->
        Map.fetch!(metadata.enum_first, type_identifier)

      %Absinthe.Type.Union{} ->
        %{__conformer_type_name: Map.fetch!(metadata.union_first, type_identifier)}

      %Absinthe.Type.Interface{} ->
        %{__conformer_type_name: Map.fetch!(metadata.interface_last, type_identifier)}

      %Absinthe.Type.Object{} ->
        %{}

      _ ->
        nil
    end
  end

  defp identifier(name) when is_binary(name) do
    name
    |> Macro.underscore()
    |> String.to_atom()
  end

  defp prime_identifier_atoms(text) do
    Regex.scan(~r/[A-Za-z_][A-Za-z0-9_]*/, text)
    |> Enum.each(fn [name] ->
      name
      |> identifier()
      |> then(fn _ -> :ok end)
    end)
  end

  defp drop_directive_definitions(schema_text, directives_to_drop) do
    schema_text
    |> String.split("\n", trim: false)
    |> do_drop_directive_definitions([], directives_to_drop)
    |> Enum.reverse()
    |> Enum.join("\n")
  end

  defp do_drop_directive_definitions([], acc, _directives_to_drop), do: acc

  defp do_drop_directive_definitions(lines, acc, directives_to_drop) do
    {descriptions, remainder} = take_leading_descriptions(lines, [])

    case remainder do
      [line | _] when is_binary(line) ->
        case directive_definition_name(line) do
          nil ->
            do_drop_directive_definitions(
              tl(remainder),
              [line | Enum.reverse(descriptions, acc)],
              directives_to_drop
            )

          name ->
            {directive_lines, rest} = take_directive_definition(remainder, [])

            if MapSet.member?(directives_to_drop, name) do
              do_drop_directive_definitions(rest, acc, directives_to_drop)
            else
              do_drop_directive_definitions(
                rest,
                Enum.reverse(directive_lines, Enum.reverse(descriptions, acc)),
                directives_to_drop
              )
            end
        end

      [] ->
        Enum.reverse(descriptions, acc)
    end
  end

  defp take_leading_descriptions([line | rest], acc) do
    trimmed = String.trim_leading(line)

    cond do
      String.starts_with?(trimmed, "\"\"\"") ->
        if String.split(trimmed, "\"\"\"") |> length() >= 3 do
          take_leading_descriptions(rest, [line | acc])
        else
          {block, remainder} = take_triple_quoted_description(rest, [line])
          take_leading_descriptions(remainder, Enum.reverse(block, acc))
        end

      String.starts_with?(trimmed, "\"") ->
        take_leading_descriptions(rest, [line | acc])

      true ->
        {Enum.reverse(acc), [line | rest]}
    end
  end

  defp take_leading_descriptions([], acc), do: {Enum.reverse(acc), []}

  defp take_triple_quoted_description([], acc), do: {Enum.reverse(acc), []}

  defp take_triple_quoted_description([line | rest], acc) do
    updated = [line | acc]

    if String.contains?(line, "\"\"\"") do
      {Enum.reverse(updated), rest}
    else
      take_triple_quoted_description(rest, updated)
    end
  end

  defp take_directive_definition([], acc), do: {Enum.reverse(acc), []}

  defp take_directive_definition([line | rest], acc) do
    updated = [line | acc]

    if directive_definition_complete?(Enum.reverse(updated) |> Enum.join("\n")) do
      {blank_lines, remainder} = take_blank_lines(rest, [])
      {Enum.reverse(blank_lines, updated), remainder}
    else
      take_directive_definition(rest, updated)
    end
  end

  defp take_blank_lines([line | rest], acc) do
    if String.trim(line) == "" do
      take_blank_lines(rest, [line | acc])
    else
      {Enum.reverse(acc), [line | rest]}
    end
  end

  defp take_blank_lines([], acc), do: {Enum.reverse(acc), []}

  defp directive_definition_name(line) do
    case Regex.run(~r/^\s*directive\s+@([A-Za-z_][A-Za-z0-9_]*)\b/, line) do
      [_, name] ->
        name

      _ ->
        nil
    end
  end

  defp directive_definition_complete?(text) do
    do_directive_definition_complete?(String.to_charlist(text), 0)
  end

  defp do_directive_definition_complete?([], _depth), do: false

  defp do_directive_definition_complete?([?( | rest], depth) do
    do_directive_definition_complete?(rest, depth + 1)
  end

  defp do_directive_definition_complete?([?) | rest], depth) when depth > 0 do
    do_directive_definition_complete?(rest, depth - 1)
  end

  defp do_directive_definition_complete?([whitespace, ?o, ?n, next | _], 0)
       when whitespace in [?\s, ?\n, ?\t] and next in [?\s, ?\n, ?\t] do
    true
  end

  defp do_directive_definition_complete?([_char | rest], depth) do
    do_directive_definition_complete?(rest, depth)
  end
end
