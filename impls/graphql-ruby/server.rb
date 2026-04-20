#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "webrick"
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
    ctx.schema.get_type(typename)
  end

  def coerce_input(_type, value, _ctx)
    value
  end

  def coerce_result(_type, value, _ctx)
    value
  end

  def resolve_value(type, schema)
    return resolve_value(type.of_type, schema) if type.kind.non_null?
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

def execute_request(body)
  schema_text = body["schema"]
  query_text = body["query"]
  variables = body["variables"]
  operation_name = body["operationName"]

  unless schema_text.is_a?(String) && query_text.is_a?(String)
    return [400, { "errors" => [{ "message" => "schema and query are required strings" }] }]
  end

  begin
    schema = GraphQL::Schema.from_definition(schema_text, default_resolve: ConformerResolver)
  rescue StandardError => e
    return [500, { "errors" => [{ "message" => e.message }] }]
  end

  result = schema.execute(query_text, variables: variables, operation_name: operation_name)
  [200, result.to_h]
end

port = Integer(ENV.fetch("PORT", "8080"))
server = WEBrick::HTTPServer.new(
  Port: port,
  BindAddress: "0.0.0.0",
  Logger: WEBrick::Log.new(File.open(File::NULL, "w")),
  AccessLog: [],
)

server.mount_proc "/health" do |_req, res|
  res.status = 200
  res["Content-Type"] = "text/plain"
  res.body = "ok"
end

server.mount_proc "/execute" do |req, res|
  unless req.request_method == "POST"
    res.status = 405
    res.body = "method not allowed"
    next
  end

  begin
    body = JSON.parse(req.body || "{}")
  rescue JSON::ParserError => e
    res.status = 400
    res["Content-Type"] = "application/json"
    res.body = JSON.generate({ "errors" => [{ "message" => "invalid JSON body: #{e.message}" }] })
    next
  end

  begin
    status, payload = execute_request(body)
  rescue StandardError => e
    status = 500
    payload = { "errors" => [{ "message" => e.message }] }
  end

  res.status = status
  res["Content-Type"] = "application/json"
  res.body = JSON.generate(payload)
end

trap("INT") { server.shutdown }
trap("TERM") { server.shutdown }

warn "graphql-ruby driver listening on :#{port}"
server.start
