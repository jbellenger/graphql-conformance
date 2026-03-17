IMPLS_DIR := impls
IMPL_DIRS := $(wildcard $(IMPLS_DIR)/*)

.PHONY: check build gen run test clean

.DEFAULT_GOAL := build

check:
	node src/check.js

build:
	node src/build.js

gen:
	$(MAKE) -C corpus-gen gen

run:
	node src/index.js

test:
	@echo "Running coordinator tests..."
	GIT_CONFIG_COUNT=2 \
	GIT_CONFIG_KEY_0=advice.defaultBranchName GIT_CONFIG_VALUE_0=false \
	GIT_CONFIG_KEY_1=init.defaultBranch GIT_CONFIG_VALUE_1=main \
	node --test src/*.test.js
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Testing $$dir..."; \
			mise exec -- $(MAKE) -C "$$dir" test || exit 1; \
		fi; \
	done

clean:
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			$(MAKE) -C "$$dir" clean || exit 1; \
		fi; \
	done
