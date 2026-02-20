FROM node:20-alpine AS frontend-builder

WORKDIR /app/ui

COPY ui/package.json ui/pnpm-lock.yaml ./

RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

COPY ui/ ./
RUN pnpm run build

FROM golang:1.25-alpine AS backend-builder

WORKDIR /app

COPY go.mod ./
COPY go.sum ./

RUN go mod download

COPY . .

COPY --from=frontend-builder /app/static ./static
RUN mkdir -p /app/logs && chmod 777 /app/logs
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o kite .

FROM alpine:3.20

RUN apk add --no-cache tzdata ca-certificates bash

ENV TZ=Asia/Kolkata

WORKDIR /app

COPY --from=backend-builder /app/kite .
COPY --from=backend-builder /app/logs ./logs

VOLUME ["/app/logs"]

EXPOSE 8080

CMD ["./kite"]
