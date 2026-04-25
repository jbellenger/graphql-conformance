FROM elixir:1.19-otp-27-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

ENV MIX_ENV=prod \
    LANG=C.UTF-8

WORKDIR /app
RUN mix local.hex --force \
 && mix local.rebar --force

COPY mix.exs ./
RUN mix deps.get --only prod

COPY lib ./lib
RUN mix compile

RUN sed -n -E 's/.*tag: "v([^"]+)".*/\1/p' mix.exs | head -1 > /impl-version

EXPOSE 8080
CMD ["mix", "run", "--no-halt"]
