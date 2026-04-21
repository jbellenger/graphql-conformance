FROM clojure:temurin-21-tools-deps-bookworm-slim

WORKDIR /app
COPY deps.edn ./
RUN clojure -P
COPY src ./src

RUN sed -n -E 's|.*com\.walmartlabs/lacinia \{:mvn/version "([^"]+)".*|\1|p' deps.edn > /impl-version

EXPOSE 8080
CMD ["clojure", "-M", "-m", "conformer-lacinia"]
