.PHONY: build test gen clean

build:
	./gradlew -q shadowJar

# SCHEMAS ?= 10
# DOCS_PER_SCHEMA ?= 10
# VARS_PER_DOC ?= 10
SCHEMAS ?= 20
DOCS_PER_SCHEMA ?= 10 
VARS_PER_DOC ?= 3

test:
	./gradlew -q test

gen:
	java -jar build/libs/corpus-gen-all.jar $(SCHEMAS) $(DOCS_PER_SCHEMA) $(VARS_PER_DOC) ../corpus

clean:
	./gradlew -q clean
