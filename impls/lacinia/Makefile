.PHONY: build test clean

build:
	test -f build/deps.edn
	npm install
	clojure -X:deps prep
	clojure -M -e "(require 'conformer-lacinia)"

test: build
	node --test conformer-harness.test.js

clean:
	rm -rf node_modules build .built-sha .cpcache
