FROM clojure:temurin-21-tools-deps-bookworm-slim

WORKDIR /app
COPY deps.edn ./
RUN clojure -P
COPY src ./src

RUN awk '/com\.walmartlabs\/lacinia/ { if (match($0, /:mvn\/version "([^"]+)"/, m)) { print m[1]; exit } }' deps.edn > /impl-version

EXPOSE 8080
CMD ["clojure", "-M", "-m", "conformer-lacinia"]
