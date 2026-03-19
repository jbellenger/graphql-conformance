.PHONY: build test clean

build:
	go mod tidy
	go build -o conformer .

test:
	go test -v ./...
	node --test conformer-harness.test.js

clean:
	rm -rf build .built-sha conformer
