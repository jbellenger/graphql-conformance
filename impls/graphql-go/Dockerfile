FROM golang:1.26 AS builder

WORKDIR /src
COPY go.mod ./
COPY server.go ./
RUN go mod tidy \
 && CGO_ENABLED=0 go build -o /out/server ./... \
 && go list -m github.com/graphql-go/graphql | awk '{print $2}' > /impl-version

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/server /server
COPY --from=builder /impl-version /impl-version

EXPOSE 8080
ENTRYPOINT ["/server"]
