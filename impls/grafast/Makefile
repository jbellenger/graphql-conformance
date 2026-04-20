.PHONY: build test clean

build:
	(cd build && corepack yarn install --immutable && corepack yarn build)

test:
	@test -f build/grafast/grafast/dist/index.js || $(MAKE) build
	node --test conformer-harness.test.js makefile.test.js

clean:
	rm -rf .built-sha
