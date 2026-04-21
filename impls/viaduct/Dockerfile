FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /src

COPY pom.xml ./
RUN mvn -B -q dependency:list -DincludeGroupIds=com.airbnb.viaduct -DincludeArtifactIds=engine-runtime -DoutputFile=/tmp/deplist.txt \
    && awk -F: '/com\.airbnb\.viaduct:engine-runtime:/ { print $4; exit }' /tmp/deplist.txt > /impl-version
COPY src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre-noble
COPY --from=builder /src/target/conformer-1.0.jar /app/server.jar
COPY --from=builder /impl-version /impl-version

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/server.jar"]
