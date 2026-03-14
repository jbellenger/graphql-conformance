IMPLS_DIR := impls
IMPL_DIRS := $(wildcard $(IMPLS_DIR)/*)

.PHONY: build run test clean check-versions update-versions

.DEFAULT_GOAL := build

build:
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Building $$dir..."; \
			$(MAKE) -C "$$dir" build || exit 1; \
		fi; \
	done

run:
	node src/index.js

test:
	echo "Running coordinator tests..."
	node --test src/*.test.js
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Testing $$dir..."; \
			$(MAKE) -C "$$dir" test || exit 1; \
		fi; \
	done

check-versions:
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			printf "$$dir: "; \
			$(MAKE) -C "$$dir" check-version 2>/dev/null || true; \
		fi; \
	done

update-versions:
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Updating $$dir..."; \
			$(MAKE) -C "$$dir" update-version || true; \
		fi; \
	done

clean:
	rm -f results.json
	for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			$(MAKE) -C "$$dir" clean || exit 1; \
		fi; \
	done
