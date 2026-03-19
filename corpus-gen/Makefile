.PHONY: build test gen clean

build:
	./gradlew -q shadowJar

# SCHEMAS ?= 10
# DOCS_PER_SCHEMA ?= 10
# VARS_PER_DOC ?= 10
SCHEMAS ?= 2
DOCS_PER_SCHEMA ?= 2
VARS_PER_DOC ?= 2

test:
	./gradlew -q test

gen:
	java -jar build/libs/corpus-gen-all.jar $(SCHEMAS) $(DOCS_PER_SCHEMA) $(VARS_PER_DOC) ../corpus

clean:
	./gradlew -q clean
