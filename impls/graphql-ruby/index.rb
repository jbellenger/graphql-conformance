#!/usr/bin/env ruby
# frozen_string_literal: true

require "bundler/setup"
require "json"
require "graphql"

module ConformerResolver
  module_function

  SCALAR_VALUES = {
    "Int" => 2,
    "Float" => 3.14,
    "String" => "str",
    "Boolean" => true,
    "ID" => "id",
  }.freeze

  def call(_type_class, field, _object, _args, ctx)
    resolve_value(field.type, ctx.schema)
  end

  def resolve_type(_abstract_type, object, ctx)
    typename = if object.is_a?(Hash)
      object["__typename"] || object[:__typename]
    end

    return nil unless typename

    ctx.query.get_type(typename)
  end

  def coerce_input(_type, value, _ctx)
    value
  end

  def coerce_result(_type, value, _ctx)
    value
  end

  def resolve_value(type, schema)
    if type.kind.non_null?
      return resolve_value(type.of_type, schema)
    end

    if type.kind.list?
      item = resolve_value(type.of_type, schema)
      return [item, item]
    end

    named_type = type.unwrap
    return SCALAR_VALUES.fetch(named_type.graphql_name, "str") if named_type.kind.scalar?
    return named_type.values.keys.first if named_type.kind.enum?

    if named_type.kind.union?
      member = named_type.possible_types.min_by(&:graphql_name)
      return { "__typename" => member.graphql_name }
    end

    if named_type.kind.interface?
      implementor = schema.possible_types(named_type).max_by(&:graphql_name)
      return { "__typename" => implementor.graphql_name }
    end

    return {} if named_type.kind.object?

    nil
  end
end

if ARGV.length < 2
  warn "Usage: bundle exec ruby index.rb <schema> <query> [<variables>]"
  exit 1
end

schema_path, query_path, variables_path = ARGV
schema_text = File.read(schema_path, encoding: "utf-8")
query_text = File.read(query_path, encoding: "utf-8")
variables = variables_path ? JSON.parse(File.read(variables_path, encoding: "utf-8")) : nil

schema = GraphQL::Schema.from_definition(schema_text, default_resolve: ConformerResolver)
result = schema.execute(query_text, variables: variables)

STDOUT.write(JSON.generate(result.to_h))
