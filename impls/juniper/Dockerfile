FROM rust:1-slim AS builder

WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release --bin server \
 && sed -n -E 's/.*rev = "([0-9a-f]+)".*/\1/p' Cargo.toml | head -1 | cut -c 1-7 > /impl-version

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/server /server
COPY --from=builder /impl-version /impl-version

EXPOSE 8080
ENTRYPOINT ["/server"]
