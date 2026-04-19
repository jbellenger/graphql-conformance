.PHONY: image shell \
        build test test-core gen-corpus run-conformer run-impl diff-impl \
        serve-site ci-smoke clean clean-results clean-corpus clean-ci \
        _build _test _test-core _gen-corpus _run-conformer \
        _prepare-smoke-corpus _run-conformer-smoke _run-impl _diff-impl \
        _serve-site _ci-smoke _clean _clean-results _clean-corpus

SMOKE_CORPUS_DIR ?= $(CURDIR)/.tmp/corpus-smoke
SMOKE_RESULTS_DIR ?= $(CURDIR)/.tmp/ci-results
SMOKE_SITE_DATA_DIR ?= $(CURDIR)/.tmp/site-data

# Host-side entry points delegate into the dev container. Inside the
# container (IN_CONTAINER=1, set by the Dockerfile) they short-circuit to
# the matching _-prefixed inner target so nested `make run-impl` calls in
# tests don't try to spawn docker-in-docker.

ifdef IN_CONTAINER

build: _build
test: _test
test-core: _test-core
gen-corpus: _gen-corpus
run-conformer: _run-conformer
run-impl: _run-impl
diff-impl: _diff-impl
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
COMPOSE ?= $(DOCKER) compose
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
DOCKER_ENV := HOST_UID=$(HOST_UID) HOST_GID=$(HOST_GID)
DOCKER_RUN := $(DOCKER_ENV) $(COMPOSE) run --rm app
DOCKER_RUN_PORTS := $(DOCKER_ENV) $(COMPOSE) run --rm --service-ports app

image:
	$(DOCKER_ENV) $(COMPOSE) build

shell:
	$(DOCKER_RUN) bash

build:
	$(DOCKER_RUN) make -C /work _build

test:
	$(DOCKER_RUN) make -C /work _test

test-core:
	$(DOCKER_RUN) make -C /work _test-core

gen-corpus:
	$(DOCKER_RUN) make -C /work _gen-corpus

run-conformer:
	$(DOCKER_RUN) make -C /work _run-conformer

run-impl:
	$(DOCKER_RUN) make -C /work _run-impl IMPL=$(IMPL) TEST=$(TEST)

diff-impl:
	$(DOCKER_RUN) make -C /work _diff-impl IMPL=$(IMPL) TEST=$(TEST)

serve-site:
	$(DOCKER_RUN_PORTS) make -C /work _serve-site

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
# Inner targets. These run inside the container; each usage-checks its
# own args so they behave correctly whether reached via the outer
# wrapper or called directly (e.g. by run-impl.test.js).
# ======================================================================

_build:
	$(MAKE) -C conformer build
	$(MAKE) -C corpus-gen build

_test:
	node --test site/build.test.js
	$(MAKE) -C results test
	$(MAKE) -C corpus-gen test
	$(MAKE) -C conformer test
	$(MAKE) -C impls test

_test-core:
	node --test site/build.test.js
	$(MAKE) -C results test
	$(MAKE) -C corpus-gen test
	$(MAKE) -C conformer test

_gen-corpus:
	$(MAKE) -C corpus-gen gen

_run-conformer:
	$(MAKE) -C conformer run
	node site/build.js results/data

_prepare-smoke-corpus:
	node scripts/prepare-smoke-corpus.js $(SMOKE_CORPUS_DIR)

_run-conformer-smoke: _prepare-smoke-corpus
	rm -rf $(SMOKE_RESULTS_DIR) $(SMOKE_SITE_DATA_DIR)
	mkdir -p $(SMOKE_RESULTS_DIR) $(SMOKE_SITE_DATA_DIR)
	CORPUS_DIR=$(SMOKE_CORPUS_DIR) RESULTS_DIR=$(SMOKE_RESULTS_DIR) node conformer/src/index.js
	SITE_DATA_DIR=$(SMOKE_SITE_DATA_DIR) node site/build.js $(SMOKE_RESULTS_DIR)

_run-impl:
	@test -n "$(IMPL)" -a -n "$(TEST)" || { echo "Usage: make run-impl IMPL=<name> TEST=<corpus-path>"; exit 1; }
	@node conformer/src/run-impl.js $(IMPL) $(TEST)

_diff-impl:
	@test -n "$(IMPL)" -a -n "$(TEST)" || { echo "Usage: make diff-impl IMPL=<name> TEST=<corpus-path>"; exit 1; }
	@node conformer/src/diff-impl.js $(IMPL) $(TEST)

_serve-site:
	node site/build.js results/data
	@printf 'Serving site at http://localhost:8000\n'
	@python3 -m http.server 8000 -d site

_ci-smoke:
	$(MAKE) _build
	$(MAKE) _test-core
	$(MAKE) _run-conformer-smoke

_clean-corpus:
	@find corpus -mindepth 1 -maxdepth 1 -type d ! -name '0' -exec rm -rf {} +

_clean-results:
	rm -rf results/data

_clean:
	$(MAKE) -C conformer clean
	$(MAKE) -C corpus-gen clean
	$(MAKE) -C impls clean
