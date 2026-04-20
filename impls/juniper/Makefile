.PHONY: build test clean

build:
	cargo build --release

test:
	cargo test
	node --test conformer-harness.test.js makefile.test.js

clean:
	rm -rf target .built-sha
