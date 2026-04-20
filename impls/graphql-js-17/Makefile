.PHONY: build test clean

build:
	(cd build && npm install && npm run build:npm)
	npm install --install-links ./build/npmDist

test:
	node --test wiring.test.js conformer-harness.test.js makefile.test.js

clean:
	rm -rf node_modules .built-sha
