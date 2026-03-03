package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	distDir := os.Getenv("DIST_DIR")
	if distDir == "" {
		distDir = "/app/dist"
	}

	mux := http.NewServeMux()

	// Health check endpoints (registered before file server)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		indexPath := filepath.Join(distDir, "index.html")
		if _, err := os.Stat(indexPath); err != nil {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(w, "not ready: index.html not found")
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	// SPA file server with fallback to index.html
	fileServer := http.FileServer(http.Dir(distDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Check if file exists on disk
		path := filepath.Join(distDir, filepath.Clean(r.URL.Path))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			// SPA fallback: serve index.html for non-existent paths
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})

	// Wrap with security headers and logging
	handler := securityHeaders(requestLogger(mux))

	log.Printf(`{"level":"info","msg":"starting server","port":"%s","dist_dir":"%s"}`, port, distDir)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf(`{"level":"error","msg":"server failed","error":"%s"}`, err)
	}
}

// securityHeaders adds security headers to all responses.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com; "+
				"style-src 'self' 'unsafe-inline'; "+
				"connect-src 'self' wss: https://www.googleapis.com https://sheets.googleapis.com https://accounts.google.com; "+
				"img-src 'self' data: https:; "+
				"frame-src https://accounts.google.com;")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// requestLogger logs each HTTP request in structured format.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf(`{"level":"info","msg":"request","method":"%s","path":"%s","status":%d,"duration_ms":%d}`,
			r.Method, r.URL.Path, wrapped.statusCode, time.Since(start).Milliseconds())
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
