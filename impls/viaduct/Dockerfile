FROM maven:3.9-eclipse-temurin-21 AS builder

ENV GRADLE_OPTS="-Xmx3g -Dorg.gradle.daemon=false"

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Clone viaduct at a pinned commit and publish the SNAPSHOT into the local
# Maven repo. The pom.xml below resolves against this local publication.
ARG VIADUCT_REPO=https://github.com/airbnb/viaduct.git
ARG VIADUCT_COMMIT=904dff16fa618bea48ef0ba0cf4abedfd68db0a8
RUN git init build \
 && cd build \
 && git remote add origin ${VIADUCT_REPO} \
 && git fetch --depth 1 origin ${VIADUCT_COMMIT} \
 && git checkout FETCH_HEAD
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
