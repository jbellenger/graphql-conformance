#!/usr/bin/env elixir

case System.argv() do
  [schema_path, query_path] ->
    schema_text = File.read!(schema_path)
    query_text = File.read!(query_path)

    schema_text
    |> ConformerAbsinthe.run(query_text)
    |> Jason.encode!()
    |> IO.write()

  [schema_path, query_path, variables_path] ->
    schema_text = File.read!(schema_path)
    query_text = File.read!(query_path)
    variables = variables_path |> File.read!() |> Jason.decode!()

    schema_text
    |> ConformerAbsinthe.run(query_text, variables)
    |> Jason.encode!()
    |> IO.write()

  _ ->
    IO.puts(:stderr, "Usage: mix run index.exs <schema> <query> [<variables>]")
    System.halt(1)
end
