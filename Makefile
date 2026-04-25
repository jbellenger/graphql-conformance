.PHONY: image shell \
        build test test-core gen-corpus run-conformer \
        serve-site ci-smoke clean clean-results clean-corpus clean-ci \
        _build _test _test-core _gen-corpus _run-conformer \
        _build-smoke _prepare-smoke-corpus _run-conformer-smoke \
        _serve-site _build-site _ci-smoke _clean _clean-results _clean-corpus

SMOKE_CORPUS_DIR ?= $(CURDIR)/.tmp/corpus-smoke
SMOKE_RESULTS_DIR ?= $(CURDIR)/.tmp/ci-results
SMOKE_SITE_DATA_DIR ?= $(CURDIR)/.tmp/site-data

# Host-side entry points delegate into the dev container. Inside the
# container (IN_CONTAINER=1, set by the Dockerfile) they short-circuit to
# the matching _-prefixed inner target.

ifdef IN_CONTAINER

build: _build
test: _test
test-core: _test-core
gen-corpus: _gen-corpus
run-conformer: _run-conformer
serve-site: _serve-site
ci-smoke: _ci-smoke
clean: _clean
clean-results: _clean-results
clean-corpus: _clean-corpus

image shell:
	@echo "'$@' is a host-side target; run it from outside the container." >&2
	@exit 1

else

DOCKER ?= docker
IMAGE ?= graphql-conformance:dev
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
# The group that owns /var/run/docker.sock (as seen inside a container)
# varies: 0 (root) on Docker Desktop's VM, `docker` (varies) on Linux
# hosts / GitHub runners. Stat the socket from inside a throwaway
# container so the GID matches what the dev container will see.
DOCKER_SOCK_GID := $(shell $(DOCKER) run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine:3 stat -c '%g' /var/run/docker.sock 2>/dev/null || echo 0)

# Preflight: fail fast with an actionable message if Docker + buildx are missing.
ifeq ($(shell command -v $(DOCKER) >/dev/null 2>&1 && echo yes),)
$(error '$(DOCKER)' not found on PATH. Install Docker 24+ (https://docs.docker.com/engine/install/).)
endif
ifeq ($(shell $(DOCKER) buildx version >/dev/null 2>&1 && echo yes),)
$(error 'docker buildx' plugin not found. Ubuntu docker.io: sudo apt install docker-buildx. Docker CE: sudo apt install docker-buildx-plugin. Docker Desktop ships it by default.)
endif

DOCKER_VOLUMES := \
  -v $(CURDIR):/work:cached \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v graphql-conformance-gradle:/home/conformance/.gradle \
  -v graphql-conformance-m2:/home/conformance/.m2

DOCKER_ENV := \
  -e CORPUS_DIR \
  -e RESULTS_DIR \
  -e SITE_DATA_DIR \
  -e REGISTRY_PATH \
  -e CONFORMER_CONCURRENCY \
  -e CONFORMER_MAX_IMPL_FAILURES \
  -e CONFORMER_STOP_TIMEOUT_SECS \
  -e CONFORMER_USE_EXISTING_IMAGE

# Graduated-testing threshold: drop a conformant from the pool after this many
# non-pass outcomes in a single run. Overridable per invocation (e.g. `make
# run-conformer CONFORMER_MAX_IMPL_FAILURES=25`); `=0` disables fallout.
# Exported so `docker run -e CONFORMER_MAX_IMPL_FAILURES` above inherits it.
CONFORMER_MAX_IMPL_FAILURES ?= 10
export CONFORMER_MAX_IMPL_FAILURES

# --init runs tini as PID 1 inside the container, which forwards
# signals and reaps zombies. Without it, Ctrl-C against serve-site can
# take multiple tries to reach the server process.
DOCKER_RUN_BASE := $(DOCKER) run --rm --init \
  --user $(HOST_UID):$(HOST_GID) \
  --group-add $(DOCKER_SOCK_GID) \
  --add-host=host.docker.internal:host-gateway \
  -w /work \
  $(DOCKER_VOLUMES) \
  $(DOCKER_ENV)

SERVE_CONTAINER_NAME := graphql-conformance-serve

DOCKER_RUN := $(DOCKER_RUN_BASE) $(IMAGE)
DOCKER_RUN_TTY := $(DOCKER_RUN_BASE) -it $(IMAGE)

image:
	$(DOCKER) build -t $(IMAGE) .

shell:
	$(DOCKER_RUN_TTY) bash

build:
	$(DOCKER_RUN) make -C /work _build

test:
	$(DOCKER_RUN) make -C /work _test

test-core:
	$(DOCKER_RUN) make -C /work _test-core

gen-corpus:
	$(DOCKER_RUN) make -C /work _gen-corpus

run-conformer:
	$(DOCKER_RUN) make -C /work _run-conformer CONFORMER_ARGS="$(CONFORMER_ARGS)"

serve-site:
	@$(DOCKER) rm -f $(SERVE_CONTAINER_NAME) >/dev/null 2>&1 || true
	$(DOCKER_RUN) make -C /work _build-site
	@printf 'Serving site at http://localhost:8000\n'
	$(DOCKER_RUN_BASE) --name $(SERVE_CONTAINER_NAME) -p 8000:8000 $(IMAGE) python3 -u -m http.server 8000 -d /work/site/dist

ci-smoke:
	$(DOCKER_RUN) make -C /work _ci-smoke

clean:
	$(DOCKER_RUN) make -C /work _clean

clean-results:
	$(DOCKER_RUN) make -C /work _clean-results

clean-corpus:
	$(DOCKER_RUN) make -C /work _clean-corpus

endif

clean-ci:
	rm -rf .tmp

# ======================================================================
# Inner targets. These run inside the container.
# ======================================================================

_build:
	$(MAKE) -C conformer build
	$(MAKE) -C corpus-gen build

_build-smoke:
	$(MAKE) -C conformer build

_test:
	cd site && npm ci && npm test
	$(MAKE) -C results test
	$(MAKE) -C corpus-gen test
	$(MAKE) -C conformer test

_test-core: _test

_gen-corpus:
	$(MAKE) -C corpus-gen gen

_run-conformer:
	$(MAKE) -C conformer run

_prepare-smoke-corpus:
	node scripts/prepare-smoke-corpus.js $(SMOKE_CORPUS_DIR)

_run-conformer-smoke: _prepare-smoke-corpus
	rm -rf $(SMOKE_RESULTS_DIR) $(SMOKE_SITE_DATA_DIR)
	mkdir -p $(SMOKE_RESULTS_DIR) $(SMOKE_SITE_DATA_DIR)
	CORPUS_DIR=$(SMOKE_CORPUS_DIR) RESULTS_DIR=$(SMOKE_RESULTS_DIR) node conformer/src/index.js
	if [ -d $(SMOKE_RESULTS_DIR) ] && [ "$$(ls -A $(SMOKE_RESULTS_DIR) 2>/dev/null)" ]; then \
	  cp -R $(SMOKE_RESULTS_DIR)/. $(SMOKE_SITE_DATA_DIR)/; \
	fi

_build-site:
	cd site && npm ci && npm run build
	mkdir -p site/dist/data
	if [ -d results/data ] && [ "$$(ls -A results/data 2>/dev/null)" ]; then \
	  cp -R results/data/. site/dist/data/; \
	fi

_serve-site: _build-site
	@printf 'Serving site at http://localhost:8000\n'
	@exec python3 -m http.server 8000 -d site/dist

_ci-smoke:
	$(MAKE) _build-smoke
	$(MAKE) _test-core
	$(MAKE) _run-conformer-smoke

_clean-corpus:
	@find corpus -mindepth 1 -maxdepth 1 -type d ! -name '0' -exec rm -rf {} +

_clean-results:
	rm -rf results/data

_clean:
	$(MAKE) -C conformer clean
	$(MAKE) -C corpus-gen clean
