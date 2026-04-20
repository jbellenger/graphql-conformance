# syntax=docker/dockerfile:1.6
#
# Dev container for the graphql-conformance monorepo.
#
# Scope: runs the conformer (Node), corpus generator (Kotlin/Gradle), site
# build (Node), and the test suites for all of the above. Per-driver runtime
# toolchains (Python, Ruby, .NET, Elixir, Go, Rust, PHP, Clojure, …) live in
# each driver's own Dockerfile under impls/<name>/ and are not installed here.

FROM debian:13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        git \
        gnupg \
        make \
        procps \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    for d in \
        /home/conformance \
        /home/conformance/.gradle \
        /home/conformance/.m2 \
        /home/conformance/.cache \
        /home/conformance/.cache/node \
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

# --- Java 21 via Adoptium Temurin APT (for corpus-gen / Gradle) ---------
RUN curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
      | gpg --dearmor > /usr/share/keyrings/adoptium.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb trixie main' \
       > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends temurin-21-jdk \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && ln -s "/usr/lib/jvm/temurin-21-jdk-${arch}" /opt/java-21

ENV HOME=/home/conformance \
    JAVA_HOME=/opt/java-21 \
    IN_CONTAINER=1 \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /work
CMD ["bash"]
