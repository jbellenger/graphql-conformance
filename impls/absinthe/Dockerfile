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

RUN awk '/:absinthe/,/}/ { if (match($0, /ref: "([0-9a-f]+)"/, m)) { print substr(m[1],1,7); exit } }' mix.exs > /impl-version || true

EXPOSE 8080
CMD ["mix", "run", "--no-halt"]
