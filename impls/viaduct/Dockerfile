FROM maven:3.9-eclipse-temurin-21 AS builder

ENV GRADLE_OPTS="-Xmx3g -Dorg.gradle.daemon=false"

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Publish viaduct SNAPSHOT into the local Maven repo. The full viaduct
# source tree is copied from ./build (vendored via git submodule / snapshot).
COPY build ./build
RUN cd build \
 && chmod +x ./gradlew \
 && ./gradlew publishToMavenLocal -x test --no-daemon \
 && VIADUCT_VERSION=$(./gradlew properties -q --no-daemon | grep '^version:' | awk '{print $2}') \
 && echo "VIADUCT_VERSION=$VIADUCT_VERSION" > /tmp/viaduct.version

COPY pom.xml ./
COPY src ./src
RUN . /tmp/viaduct.version \
 && mvn -B -q package -DskipTests -Dviaduct.version=$VIADUCT_VERSION

FROM eclipse-temurin:21-jre-noble
COPY --from=builder /src/target/conformer-1.0.jar /app/server.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/server.jar"]
