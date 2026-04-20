.PHONY: build test clean

build:
	(cd build && ./gradlew publishToMavenLocal -x test)
	mvn package -DskipTests -Dgraphql-java.version=$$(cd build && ./gradlew properties -q | grep '^version:' | awk '{print $$2}')

test:
	mvn test
	node --test conformer-harness.test.js makefile.test.js

clean:
	rm -rf .built-sha
	mvn clean
