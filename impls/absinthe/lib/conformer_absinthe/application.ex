defmodule ConformerAbsinthe.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    port = String.to_integer(System.get_env("PORT", "8080"))

    children = [
      {Plug.Cowboy, scheme: :http, plug: ConformerAbsinthe.Router, options: [port: port, ip: {0, 0, 0, 0}]}
    ]

    opts = [strategy: :one_for_one, name: ConformerAbsinthe.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
