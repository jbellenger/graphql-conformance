.PHONY: build test clean

build:
	test -f build/graphql.gemspec
	bundle config set --local path vendor/bundle
	bundle install
	bundle exec ruby -c index.rb >/dev/null

test: build
	node --test conformer-harness.test.js

clean:
	rm -rf build .built-sha .bundle vendor
