package main

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

//go:embed static/index.html
var indexHTML []byte

type server struct {
	clickhouseURL string
	httpClient    *http.Client
}

type hookRow struct {
	EventTime string `json:"event_time"`
	EventName string `json:"event_name"`
	SessionID string `json:"session_id"`
}

func main() {
	port := env("PORT", "4000")
	s := &server{
		clickhouseURL: strings.TrimRight(env("CLICKHOUSE_URL", "http://localhost:8123"), "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	if err := s.ensureSchema(context.Background()); err != nil {
		log.Fatalf("ensure schema: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.handleIndex)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /api/hooks", s.handleCreateHook)
	mux.HandleFunc("GET /api/hooks", s.handleListHooks)

	addr := ":" + port
	log.Printf("traceframe listening on http://localhost%s", addr)
	if err := http.ListenAndServe(addr, logRequest(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) handleIndex(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	_, _ = w.Write(indexHTML)
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	err := s.exec(r.Context(), "SELECT 1")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":         false,
			"clickhouse": "unavailable",
			"error":      err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"clickhouse": "connected",
	})
}

func (s *server) handleCreateHook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 10<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "request body too large"})
		return
	}
	if len(bytes.TrimSpace(body)) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "empty request body"})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}

	eventName := stringField(payload, "hook_event_name")
	if eventName == "" {
		eventName = "Unknown"
	}

	row := map[string]string{
		"event_name": eventName,
		"session_id": stringField(payload, "session_id"),
		"payload":    string(body),
	}
	rowJSON, err := json.Marshal(row)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "encode row"})
		return
	}

	query := "INSERT INTO claude_hooks (event_name, session_id, payload) FORMAT JSONEachRow"
	if err := s.query(r.Context(), query, append(rowJSON, '\n')); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "insert failed", "detail": err.Error()})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":         true,
		"event_name": eventName,
	})
}

func (s *server) handleListHooks(w http.ResponseWriter, r *http.Request) {
	limit := "100"
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit = raw
	}

	query := fmt.Sprintf(`
		SELECT
			formatDateTime(event_time, '%%Y-%%m-%%dT%%H:%%i:%%S.%%fZ', 'UTC') AS event_time,
			event_name,
			session_id
		FROM claude_hooks
		ORDER BY event_time DESC
		LIMIT %d
		FORMAT JSONEachRow
	`, clickhouseUInt(limit, 100))

	data, err := s.queryBytes(r.Context(), query, nil)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "query failed", "detail": err.Error()})
		return
	}

	rows := make([]hookRow, 0)
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		var row hookRow
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "decode row", "detail": err.Error()})
			return
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "scan rows", "detail": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"hooks": rows})
}

func (s *server) ensureSchema(ctx context.Context) error {
	deadline, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	var lastErr error
	for deadline.Err() == nil {
		err := s.exec(deadline, `
			CREATE TABLE IF NOT EXISTS claude_hooks
			(
				event_time DateTime64(3) DEFAULT now64(3),
				event_name String,
				session_id String,
				payload String
			)
			ENGINE = MergeTree
			ORDER BY (event_time, event_name)
		`)
		if err == nil {
			return nil
		}
		lastErr = err
		time.Sleep(time.Second)
	}
	if lastErr == nil {
		lastErr = deadline.Err()
	}
	return lastErr
}

func (s *server) exec(ctx context.Context, query string) error {
	return s.query(ctx, query, nil)
}

func (s *server) query(ctx context.Context, query string, body []byte) error {
	_, err := s.queryBytes(ctx, query, body)
	return err
}

func (s *server) queryBytes(ctx context.Context, query string, body []byte) ([]byte, error) {
	endpoint := s.clickhouseURL + "/?query=" + url.QueryEscape(strings.TrimSpace(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if len(body) > 0 {
		req.Header.Set("content-type", "application/json")
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, readErr := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(data))
		if msg == "" {
			msg = resp.Status
		}
		return nil, errors.New(msg)
	}
	if readErr != nil {
		return nil, readErr
	}
	return data, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func stringField(payload map[string]any, key string) string {
	value, ok := payload[key].(string)
	if !ok {
		return ""
	}
	return value
}

func clickhouseUInt(raw string, fallback uint64) uint64 {
	var n uint64
	for _, ch := range raw {
		if ch < '0' || ch > '9' {
			return fallback
		}
		n = n*10 + uint64(ch-'0')
		if n > 1000 {
			return 1000
		}
	}
	if n == 0 {
		return fallback
	}
	return n
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
