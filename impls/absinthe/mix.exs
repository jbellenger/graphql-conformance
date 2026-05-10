defmodule ConformerAbsinthe.MixProject do
  use Mix.Project

  def project do
    [
      app: :conformer_absinthe,
      version: "0.1.0",
      elixir: "~> 1.19",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {ConformerAbsinthe.Application, []}
    ]
  end

  defp deps do
    [
      {:absinthe,
       git: "https://github.com/absinthe-graphql/absinthe.git",
       tag: "v1.10.2"},
      {:jason, "~> 1.4"},
      {:plug_cowboy, "~> 2.7"}
    ]
  end
end
