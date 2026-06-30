FROM golang:1.23-alpine AS build

WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY static ./static
RUN go build -o /out/traceframe .

FROM alpine:3.20

RUN adduser -D -H app
USER app
WORKDIR /app
COPY --from=build /out/traceframe /app/traceframe

ENV PORT=4000
EXPOSE 4000

CMD ["/app/traceframe"]
