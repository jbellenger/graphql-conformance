.PHONY: build test clean check-version update-version

.DEFAULT_GOAL := build

build:
	npm install

test:
	node --test wiring.test.js conformer-harness.test.js

PACKAGE := graphql
CURRENT := $(shell node -e "console.log(require('./node_modules/graphql/package.json').version)")
LATEST := $(shell curl -s https://registry.npmjs.org/$(PACKAGE) | jq -r '.["dist-tags"].latest')

check-version:
	@echo "$(CURRENT) $(LATEST)"
	@[ "$(CURRENT)" = "$(LATEST)" ]

update-version:
	npm install $(PACKAGE)@latest

clean:
	rm -rf node_modules
