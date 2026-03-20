defmodule ConformerAbsinthe.DirectiveSupport do
  @moduledoc false

  alias Absinthe.{Blueprint, Pipeline, Schema, Type}
  alias Absinthe.Blueprint.Input

  @schema_known_directives_phase Absinthe.Phase.Schema.Validation.KnownDirectives
  @document_resolution_anchor Absinthe.Phase.Document.Arguments.VariableTypesMatch

  def pipeline(pipeline) do
    pipeline
    |> insert_before_if_present(@schema_known_directives_phase, __MODULE__.SchemaPhase)
    |> insert_before_if_present(@document_resolution_anchor, __MODULE__.DocumentPhase)
  end

  def resolve_schema_blueprint(%Blueprint{} = blueprint) do
    directive_lookup = schema_directive_lookup(blueprint)
    type_lookup = schema_type_lookup(blueprint)

    # This phase only connects imported SDL directive applications to directive
    # definitions that already exist in the blueprint/prototype schema.
    resolve_blueprint_directives(blueprint, directive_lookup, type_lookup, blueprint.adapter)
  end

  def resolve_document_blueprint(%Blueprint{schema: schema} = blueprint)
      when not is_nil(schema) do
    # Document directives are resolved against the already-compiled schema.
    resolve_blueprint_directives(blueprint, schema, schema, blueprint.adapter)
  end

  def resolve_document_blueprint(%Blueprint{} = blueprint), do: blueprint

  defp insert_before_if_present(pipeline, phase, additional) do
    if Enum.any?(List.flatten(pipeline), &phase_match?(&1, phase)) do
      Pipeline.insert_before(pipeline, phase, additional)
    else
      pipeline
    end
  end

  defp phase_match?({candidate, _}, phase), do: candidate == phase
  defp phase_match?(candidate, phase), do: candidate == phase

  defp schema_directive_lookup(%Blueprint{schema_definitions: schema_definitions} = blueprint) do
    schema_directives =
      schema_definitions
      |> Enum.flat_map(fn schema_definition ->
        schema_definition.directive_definitions
        |> Enum.map(fn directive_definition ->
          directive_definition
          |> Blueprint.Schema.DirectiveDefinition.build(schema_definition)
          |> Map.merge(%{
            definition: directive_definition.module,
            __reference__: directive_definition.__reference__,
            __private__: directive_definition.__private__
          })
        end)
      end)

    prototype_directives =
      case blueprint.prototype_schema do
        nil -> []
        prototype_schema -> Schema.directives(prototype_schema)
      end

    Enum.reduce(schema_directives ++ prototype_directives, %{}, &put_directive_lookup_entry/2)
  end

  defp schema_type_lookup(%Blueprint{} = blueprint) do
    blueprint
    |> Absinthe.Phase.Schema.Build.build_types()
    |> Map.new(&{&1.identifier, &1})
  end

  defp put_directive_lookup_entry(directive, lookup) do
    candidates =
      directive.name
      |> directive_candidates(nil)
      |> Enum.concat([directive.identifier])

    Enum.reduce(candidates, lookup, fn candidate, acc ->
      Map.put_new(acc, candidate, directive)
    end)
  end

  defp resolve_blueprint_directives(
         %Blueprint{} = blueprint,
         directive_source,
         type_source,
         adapter
       ) do
    Blueprint.prewalk(blueprint, fn
      %Blueprint.Directive{} = directive ->
        resolve_directive(directive, directive_source, type_source, adapter)

      node ->
        node
    end)
  end

  defp resolve_directive(
         %Blueprint.Directive{} = directive,
         directive_source,
         type_source,
         adapter
       ) do
    directive_schema_node =
      directive.schema_node || lookup_directive(directive_source, directive.name, adapter)

    if directive_schema_node do
      arguments =
        Enum.map(directive.arguments, fn argument ->
          resolve_argument(argument, directive_schema_node, type_source, adapter)
        end)

      %{directive | schema_node: directive_schema_node, arguments: arguments}
    else
      directive
    end
  end

  defp resolve_argument(argument, directive_schema_node, type_source, adapter) do
    argument_schema_node =
      argument.schema_node ||
        find_named_entry(
          Map.values(directive_schema_node.args),
          argument.name,
          adapter,
          :argument
        )

    input_value =
      hydrate_input_value(
        argument.input_value,
        argument_schema_node && expand_type(argument_schema_node.type, type_source),
        type_source,
        adapter
      )

    %{argument | schema_node: argument_schema_node, input_value: input_value}
  end

  defp hydrate_input_value(nil, _schema_node, _type_source, _adapter), do: nil

  defp hydrate_input_value(%Input.Value{} = value, schema_node, type_source, adapter) do
    normalized_schema_node = expand_type(schema_node, type_source)

    normalized =
      hydrate_input_node(value.normalized, normalized_schema_node, type_source, adapter)

    %{value | schema_node: normalized_schema_node, normalized: normalized}
  end

  defp hydrate_input_node(%Input.Object{} = object, schema_node, type_source, adapter) do
    input_object_type =
      schema_node
      |> expand_type(type_source)
      |> Type.unwrap_non_null()

    fields =
      Enum.map(object.fields, fn field ->
        field_schema_node =
          case input_object_type do
            %Type.InputObject{fields: fields} ->
              find_named_entry(Map.values(fields), field.name, adapter, :field)

            _ ->
              nil
          end

        input_value =
          hydrate_input_value(
            field.input_value,
            field_schema_node && expand_type(field_schema_node.type, type_source),
            type_source,
            adapter
          )

        %{field | schema_node: field_schema_node, input_value: input_value}
      end)

    %{object | schema_node: schema_node, fields: fields}
  end

  defp hydrate_input_node(%Input.List{} = list, schema_node, type_source, adapter) do
    item_schema_node =
      case schema_node |> expand_type(type_source) |> Type.unwrap_non_null() do
        %Type.List{of_type: item_type} -> expand_type(item_type, type_source)
        _ -> nil
      end

    items = Enum.map(list.items, &hydrate_input_value(&1, item_schema_node, type_source, adapter))
    %{list | schema_node: schema_node, items: items}
  end

  defp hydrate_input_node(%struct{} = value, schema_node, _type_source, _adapter)
       when struct in [
              Input.Boolean,
              Input.Enum,
              Input.Float,
              Input.Integer,
              Input.Null,
              Input.String
            ] do
    %{value | schema_node: schema_node}
  end

  defp hydrate_input_node(value, _schema_node, _type_source, _adapter), do: value

  defp lookup_directive(%{} = directive_lookup, name, adapter) do
    name
    |> directive_candidates(adapter)
    |> Enum.find_value(&Map.get(directive_lookup, &1))
  end

  defp lookup_directive(schema, name, adapter) when is_atom(schema) do
    name
    |> directive_candidates(adapter)
    |> Enum.find_value(&schema.__absinthe_directive__(&1))
  end

  defp directive_candidates(name, adapter) do
    internal_name =
      cond do
        is_nil(name) ->
          nil

        is_nil(adapter) ->
          Macro.underscore(name)

        true ->
          adapter.to_internal_name(name, :directive)
      end

    atom_candidate =
      case internal_name do
        nil -> nil
        value -> String.to_atom(value)
      end

    [name, internal_name, atom_candidate]
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp find_named_entry(entries, name, adapter, role) do
    {string_candidates, atom_candidates} = name_candidates(name, adapter, role)

    Enum.find(entries, fn entry ->
      entry.name in string_candidates || entry.identifier in atom_candidates
    end)
  end

  defp name_candidates(name, adapter, role) do
    internal_name =
      cond do
        is_nil(name) ->
          nil

        is_nil(adapter) ->
          Macro.underscore(name)

        true ->
          adapter.to_internal_name(name, role)
      end

    string_candidates =
      [name, internal_name]
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    atom_candidates =
      string_candidates
      |> Enum.map(&Macro.underscore/1)
      |> Enum.map(&String.to_atom/1)
      |> Enum.uniq()

    {string_candidates, atom_candidates}
  end

  defp expand_type(nil, _type_source), do: nil

  defp expand_type(%Type.NonNull{of_type: inner_type} = type, type_source) do
    %{type | of_type: expand_type(inner_type, type_source)}
  end

  defp expand_type(%Type.List{of_type: inner_type} = type, type_source) do
    %{type | of_type: expand_type(inner_type, type_source)}
  end

  defp expand_type(type_identifier, type_lookup)
       when is_atom(type_identifier) and is_map(type_lookup) do
    Map.get(type_lookup, type_identifier, type_identifier)
  end

  defp expand_type(type, type_lookup) when is_map(type_lookup), do: type

  defp expand_type(type, schema) when is_atom(schema) do
    Type.expand(type, schema)
  end

  defmodule SchemaPhase do
    use Absinthe.Phase

    def run(input, _options \\ []) do
      {:ok, ConformerAbsinthe.DirectiveSupport.resolve_schema_blueprint(input)}
    end
  end

  defmodule DocumentPhase do
    use Absinthe.Phase

    def run(input, _options \\ []) do
      {:ok, ConformerAbsinthe.DirectiveSupport.resolve_document_blueprint(input)}
    end
  end
end
