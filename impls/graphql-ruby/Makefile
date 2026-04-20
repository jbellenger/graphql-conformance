.PHONY: build test clean

build:
	test -f build/graphql.gemspec
	bundle config set --local path vendor/bundle
	bundle install
	bundle exec ruby -c index.rb >/dev/null

test:
	node --test conformer-harness.test.js makefile.test.js

clean:
	rm -rf .built-sha .bundle vendor
