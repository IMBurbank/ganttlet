# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.22-alpine AS go-build
WORKDIR /app
COPY deploy/frontend/go.mod deploy/frontend/main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# Stage 3: Minimal runtime
FROM gcr.io/distroless/static-debian12
COPY --from=go-build /app/server /server
COPY --from=frontend-build /app/dist /app/dist
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
