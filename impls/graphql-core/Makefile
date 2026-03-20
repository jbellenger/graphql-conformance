.PHONY: build test clean

build:
	test -f build/src/graphql/__init__.py
	PYTHONPATH=build/src python3 -c "import graphql" >/dev/null
	python3 -m py_compile index.py

test: build
	node --test conformer-harness.test.js

clean:
	rm -rf build .built-sha __pycache__
