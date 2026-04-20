FROM clojure:temurin-21-tools-deps-bookworm-slim

WORKDIR /app
COPY deps.edn ./
RUN clojure -P
COPY src ./src

EXPOSE 8080
CMD ["clojure", "-M", "-m", "conformer-lacinia"]
