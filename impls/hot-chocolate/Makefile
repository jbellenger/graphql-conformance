.PHONY: build test clean

build:
	dotnet publish Conformer.csproj -c Release -o out

test:
	node --test conformer-harness.test.js

clean:
	rm -rf bin obj out build .built-sha
