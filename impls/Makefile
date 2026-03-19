IMPL_DIRS := $(wildcard */)

.PHONY: build test clean

build:
	@for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Building $$dir..."; \
			mise exec -- $(MAKE) -C "$$dir" build || exit 1; \
		fi; \
	done

test:
	@for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			echo "Testing $$dir..."; \
			mise exec -- $(MAKE) -C "$$dir" test || exit 1; \
		fi; \
	done

clean:
	@for dir in $(IMPL_DIRS); do \
		if [ -f "$$dir/Makefile" ]; then \
			$(MAKE) -C "$$dir" clean || exit 1; \
		fi; \
	done
