FROM golang:1.22 AS builder

WORKDIR /src
COPY go.mod ./
COPY server.go ./
RUN go mod tidy \
 && CGO_ENABLED=0 go build -o /out/server ./...

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/server /server

EXPOSE 8080
ENTRYPOINT ["/server"]
