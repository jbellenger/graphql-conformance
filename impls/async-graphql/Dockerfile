FROM rust:1-slim AS builder

WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release --bin server \
 && cargo tree --package async-graphql-driver --depth 1 --prefix none \
      | awk '/^async-graphql v/ {print $2; exit}' \
      | sed 's/^v//' > /impl-version

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/server /server
COPY --from=builder /impl-version /impl-version

EXPOSE 8080
ENTRYPOINT ["/server"]
