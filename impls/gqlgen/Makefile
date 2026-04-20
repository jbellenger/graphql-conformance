.PHONY: build test clean

build:
	go mod tidy
	go build -o conformer .

test:
	go test -v ./...
	node --test conformer-harness.test.js makefile.test.js

clean:
	rm -rf .built-sha conformer
