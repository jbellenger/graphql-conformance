FROM rust:1-slim AS builder

WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release --bin server

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/server /server

EXPOSE 8080
ENTRYPOINT ["/server"]
