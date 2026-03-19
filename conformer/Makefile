.PHONY: check build run test clean

.DEFAULT_GOAL := build

check:
	node src/check.js

build:
	npm install
	node src/build.js

run:
	node src/index.js

test:
	@echo "Running coordinator tests..."
	GIT_CONFIG_COUNT=2 \
	GIT_CONFIG_KEY_0=advice.defaultBranchName GIT_CONFIG_VALUE_0=false \
	GIT_CONFIG_KEY_1=init.defaultBranch GIT_CONFIG_VALUE_1=main \
	node --test src/*.test.js

clean:
	rm -rf node_modules
