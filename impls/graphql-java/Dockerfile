FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /src
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline || true
COPY src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre-noble
COPY --from=builder /src/target/conformer-1.0.jar /app/server.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/server.jar"]
