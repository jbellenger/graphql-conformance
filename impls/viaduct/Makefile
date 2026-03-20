.PHONY: build test clean

build:
	(cd build && ./gradlew publishToMavenLocal -x test)
	mvn package -DskipTests -Dviaduct.version=$$(cd build && ./gradlew properties -q | grep '^version:' | awk '{print $$2}')

test:
	mvn test -Dviaduct.version=$$(cd build && ./gradlew properties -q | grep '^version:' | awk '{print $$2}')
	node --test conformer-harness.test.js

clean:
	rm -rf build .built-sha
	mvn clean
