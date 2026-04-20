defmodule ConformerAbsinthe.Router do
  @moduledoc false

  use Plug.Router

  plug(Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason
  )

  plug(:match)
  plug(:dispatch)

  get "/health" do
    send_resp(conn, 200, "ok")
  end

  post "/execute" do
    case conn.body_params do
      %{"schema" => schema_text, "query" => query_text} = body
      when is_binary(schema_text) and is_binary(query_text) ->
        variables = Map.get(body, "variables")

        try do
          result = ConformerAbsinthe.run(schema_text, query_text, variables)

          conn
          |> put_resp_content_type("application/json")
          |> send_resp(200, Jason.encode!(result))
        rescue
          e ->
            conn
            |> put_resp_content_type("application/json")
            |> send_resp(
              500,
              Jason.encode!(%{errors: [%{message: Exception.message(e)}]})
            )
        end

      _ ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(
          400,
          Jason.encode!(%{errors: [%{message: "schema and query are required strings"}]})
        )
    end
  end

  match _ do
    send_resp(conn, 404, "not found")
  end
end
