IMPL_DIRS := $(wildcard */)
RUN_IMPL_MAKE := node ../conformer/src/impl-make.js

.PHONY: build test clean

build:
	@for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Building $$dir..."; \
			$(RUN_IMPL_MAKE) "$$dir" build || exit 1; \
		fi; \
	done

test:
	@for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Testing $$dir..."; \
			$(RUN_IMPL_MAKE) "$$dir" test || exit 1; \
		fi; \
	done

clean:
	@for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			$(MAKE) -C "$$dir" clean || exit 1; \
		fi; \
	done
