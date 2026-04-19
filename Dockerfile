# syntax=docker/dockerfile:1.6

FROM debian:12-slim AS base

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
        libncursesw5-dev \
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
        python3 \
        re2c \
        unzip \
        xz-utils \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh \
    && mise --version

RUN mkdir -p /home/conformance \
    && chmod 1777 /home/conformance \
    && git config --system --add safe.directory '*'

ENV HOME=/home/conformance \
    MISE_DATA_DIR=/opt/mise \
    MISE_TRUSTED_CONFIG_PATHS=/work/.mise.toml \
    MISE_YES=1 \
    IN_CONTAINER=1 \
    PATH=/opt/mise/shims:/usr/local/bin:/usr/bin:/bin:/sbin


FROM base AS toolchains

WORKDIR /work
COPY .mise.toml /work/.mise.toml
RUN mise install \
    && /opt/mise/shims/corepack enable \
    && mise reshim \
    && chmod -R go+rX /opt/mise


FROM base AS runtime

COPY --from=toolchains /opt/mise /opt/mise
WORKDIR /work
CMD ["bash"]
