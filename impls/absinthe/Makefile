.PHONY: build test clean

build:
	test -f build/mix.exs
	mix deps.get
	mix compile

test: build
	node --test conformer-harness.test.js

clean:
	rm -rf _build .built-sha deps
