.PHONY: build test clean

build:
	test -f build/src/GraphQL.php
	php -l index.php >/dev/null

test: build
	node --test conformer-harness.test.js makefile.test.js

clean:
	rm -rf .built-sha
