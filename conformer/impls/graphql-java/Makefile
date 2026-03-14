.PHONY: build test clean check-version update-version

.DEFAULT_GOAL := build

build:
	mvn package -DskipTests

test:
	mvn test
	node --test conformer-harness.test.js

ARTIFACT := graphql-java
CURRENT := $(shell grep -A1 '<artifactId>$(ARTIFACT)</artifactId>' pom.xml | grep '<version>' | sed 's/.*<version>\(.*\)<\/version>.*/\1/')
LATEST := $(shell curl -s https://api.github.com/repos/graphql-java/graphql-java/releases/latest | jq -r '.tag_name | ltrimstr("v")')

check-version:
	@echo "$(CURRENT) $(LATEST)"
	@[ "$(CURRENT)" = "$(LATEST)" ]

update-version:
	sed -i.bak -E '/<artifactId>$(ARTIFACT)<\/artifactId>/{n;s|<version>[^<]+</version>|<version>$(LATEST)</version>|;}' pom.xml
	rm -f pom.xml.bak

clean:
	mvn clean
