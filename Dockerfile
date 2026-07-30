# templ requires Go 1.25; keep this in step with the `go` directive in go.mod.
FROM golang:1.25-alpine AS build

WORKDIR /src
# Dependencies first so the module cache survives source-only rebuilds.
COPY go.mod go.sum ./
RUN go mod download
# Copy every Go file, not just main.go — naming files individually here meant a
# new .go file broke the image while building fine locally.
COPY *.go ./
COPY components ./components
COPY static ./static
# The generated *_templ.go files are committed, so no templ binary is needed
# here; run `templ generate` before committing instead.
RUN go build -o /out/traceframe .

FROM alpine:3.20

RUN adduser -D -H -h /app app
ENV HOME=/app
USER app
WORKDIR /app
COPY --from=build /out/traceframe /app/traceframe

ENV PORT=4000
EXPOSE 4000

CMD ["/app/traceframe"]
