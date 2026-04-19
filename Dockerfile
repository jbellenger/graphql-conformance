# syntax=docker/dockerfile:1.6

FROM python:3.14-slim-trixie AS python-stage
FROM ruby:3.4-slim-trixie AS ruby-stage
FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS dotnet-stage
FROM elixir:1.19-otp-28-slim AS elixir-stage

FROM debian:13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
        autoconf \
        automake \
        bison \
        build-essential \
        ca-certificates \
        curl \
        default-libmysqlclient-dev \
        file \
        git \
        gnupg \
        libbz2-dev \
        libcurl4-openssl-dev \
        libffi-dev \
        libfreetype6-dev \
        libgd-dev \
        libicu-dev \
        libjpeg-dev \
        libldap2-dev \
        libldb-dev \
        libncurses-dev \
        libonig-dev \
        libpng-dev \
        libpq-dev \
        libreadline-dev \
        libsqlite3-dev \
        libssl-dev \
        libtool \
        libxml2-dev \
        libxpm-dev \
        libxslt-dev \
        libyaml-dev \
        libzip-dev \
        make \
        pkg-config \
        procps \
        unzip \
        xz-utils \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    for d in \
        /home/conformance \
        /home/conformance/.m2 \
        /home/conformance/.gradle \
        /home/conformance/.cargo \
        /home/conformance/.cargo/registry \
        /home/conformance/.cargo/git \
        /home/conformance/.cache \
        /home/conformance/.cache/pip \
        /home/conformance/.cache/go-build \
        /home/conformance/.cache/node \
        /home/conformance/go \
        /home/conformance/go/pkg \
        /home/conformance/go/pkg/mod \
        /home/conformance/.gem \
        /home/conformance/.mix \
        /home/conformance/.nuget \
    ; do \
        mkdir -p "$d"; \
        chmod 1777 "$d"; \
    done; \
    git config --system --add safe.directory '*'; \
    git config --system user.name 'conformance'; \
    git config --system user.email 'conformance@localhost'

# --- Node 22 via NodeSource ----------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# --- Go 1.25 via go.dev tarball -----------------------------------------
ARG GO_VERSION=1.25.0
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) goarch=amd64 ;; \
         arm64) goarch=arm64 ;; \
         *) echo "Unsupported arch: $arch" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${goarch}.tar.gz" \
      | tar -C /usr/local -xz

# --- Java 21 via Adoptium Temurin APT -----------------------------------
# Resolve the arch-specific jdk directory (temurin-21-jdk-amd64 or -arm64)
# to an arch-independent path at /opt/java-21 so JAVA_HOME works everywhere.
RUN curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
      | gpg --dearmor > /usr/share/keyrings/adoptium.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb trixie main' \
       > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends temurin-21-jdk \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s "$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")" /opt/java-21

# --- Maven 3.9 via Apache archive ---------------------------------------
ARG MAVEN_VERSION=3.9.9
RUN curl -fsSL "https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz" \
      | tar -C /opt -xz \
    && ln -s "/opt/apache-maven-${MAVEN_VERSION}/bin/mvn" /usr/local/bin/mvn

# --- .NET 8 carried over from mcr.microsoft.com/dotnet/sdk:8.0 ----------
COPY --from=dotnet-stage /usr/share/dotnet /usr/share/dotnet
RUN ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet

# --- PHP 8.4 via deb.sury.org -------------------------------------------
RUN curl -fsSL https://packages.sury.org/php/apt.gpg \
      > /usr/share/keyrings/sury-php.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/sury-php.gpg] https://packages.sury.org/php/ trixie main' \
       > /etc/apt/sources.list.d/sury-php.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
         php8.4-cli php8.4-xml php8.4-mbstring php8.4-curl php8.4-zip \
    && rm -rf /var/lib/apt/lists/*

# --- Rust 1.89 via rustup -----------------------------------------------
# Toolchains live under RUSTUP_HOME; install-time shims are copied into
# /usr/local/bin so runtime users pick them up on PATH. Runtime CARGO_HOME
# defaults to $HOME/.cargo so package caches land in the user's home.
ARG RUST_VERSION=1.89.0
RUN curl -fsSL https://sh.rustup.rs \
      | RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo \
        sh -s -- -y --default-toolchain ${RUST_VERSION} --profile minimal --no-modify-path \
    && cp /opt/cargo/bin/* /usr/local/bin/ \
    && rm -rf /opt/cargo \
    && chmod -R go+rX /opt/rustup

# --- Erlang + Elixir carried over from elixir:1.19-otp-28 ---------------
COPY --from=elixir-stage /usr/local/lib/erlang /usr/local/lib/erlang
COPY --from=elixir-stage /usr/local/lib/elixir /usr/local/lib/elixir
RUN for bin in erl erlc escript ct_run dialyzer typer epmd run_erl to_erl; do \
      if [ -e /usr/local/lib/erlang/bin/$bin ]; then \
        ln -sf /usr/local/lib/erlang/bin/$bin /usr/local/bin/$bin; \
      fi; \
    done \
    && for bin in elixir elixirc iex mix; do \
      ln -sf /usr/local/lib/elixir/bin/$bin /usr/local/bin/$bin; \
    done

# --- Clojure via official installer -------------------------------------
ARG CLOJURE_VERSION=1.12.4.1618
RUN curl -fsSL "https://download.clojure.org/install/linux-install-${CLOJURE_VERSION}.sh" \
      -o /tmp/install-clojure.sh \
    && bash /tmp/install-clojure.sh \
    && rm /tmp/install-clojure.sh

# --- Python 3.14 carried over from python:3.14-slim-trixie --------------
COPY --from=python-stage /usr/local/bin/python3.14 /usr/local/bin/python3.14
COPY --from=python-stage /usr/local/bin/pip3.14 /usr/local/bin/pip3.14
COPY --from=python-stage /usr/local/lib/python3.14 /usr/local/lib/python3.14
COPY --from=python-stage /usr/local/lib/libpython3.14.so.1.0 /usr/local/lib/libpython3.14.so.1.0
COPY --from=python-stage /usr/local/include/python3.14 /usr/local/include/python3.14
RUN ln -sf /usr/local/bin/python3.14 /usr/local/bin/python3 \
    && ln -sf /usr/local/bin/python3.14 /usr/local/bin/python \
    && ln -sf /usr/local/bin/pip3.14 /usr/local/bin/pip3 \
    && ln -sf /usr/local/bin/pip3.14 /usr/local/bin/pip \
    && ldconfig

# --- Ruby 3.4 carried over from ruby:3.4-slim-trixie --------------------
COPY --from=ruby-stage /usr/local/bin/ruby /usr/local/bin/ruby
COPY --from=ruby-stage /usr/local/bin/gem /usr/local/bin/gem
COPY --from=ruby-stage /usr/local/bin/bundle /usr/local/bin/bundle
COPY --from=ruby-stage /usr/local/bin/bundler /usr/local/bin/bundler
COPY --from=ruby-stage /usr/local/bin/rake /usr/local/bin/rake
COPY --from=ruby-stage /usr/local/bin/irb /usr/local/bin/irb
COPY --from=ruby-stage /usr/local/bin/erb /usr/local/bin/erb
COPY --from=ruby-stage /usr/local/bin/rdoc /usr/local/bin/rdoc
COPY --from=ruby-stage /usr/local/bin/ri /usr/local/bin/ri
COPY --from=ruby-stage /usr/local/bin/racc /usr/local/bin/racc
COPY --from=ruby-stage /usr/local/bin/typeprof /usr/local/bin/typeprof
COPY --from=ruby-stage /usr/local/lib/ruby /usr/local/lib/ruby
COPY --from=ruby-stage /usr/local/include/ruby-3.4.0 /usr/local/include/ruby-3.4.0
COPY --from=ruby-stage /usr/local/lib/libruby.so.3.4 /usr/local/lib/libruby.so.3.4
RUN ldconfig

ENV HOME=/home/conformance \
    JAVA_HOME=/opt/java-21 \
    RUSTUP_HOME=/opt/rustup \
    DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    IN_CONTAINER=1 \
    PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /work
CMD ["bash"]
