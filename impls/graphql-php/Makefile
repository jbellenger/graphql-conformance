.PHONY: build test clean

build:
	test -f build/src/GraphQL.php
	php -l index.php >/dev/null

test: build
	node --test conformer-harness.test.js

clean:
	rm -rf build .built-sha
