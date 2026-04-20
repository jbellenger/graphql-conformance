.PHONY: build run test clean

.DEFAULT_GOAL := build

build:
	npm install

run:
	node src/index.js

test:
	@echo "Running conformer tests..."
	GIT_CONFIG_COUNT=2 \
	GIT_CONFIG_KEY_0=advice.defaultBranchName GIT_CONFIG_VALUE_0=false \
	GIT_CONFIG_KEY_1=init.defaultBranch GIT_CONFIG_VALUE_1=main \
	node --test src/*.test.js

clean:
	rm -rf node_modules
