package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

//go:embed static/index.html
var staticFiles embed.FS

var indexHTML []byte

func init() {
	var err error
	indexHTML, err = staticFiles.ReadFile("static/index.html")
	if err != nil {
		panic(err)
	}
}

type server struct {
	clickhouseURL string
	httpClient    *http.Client
}

type hookRow struct {
	EventTime   string `json:"event_time"`
	EventName   string `json:"event_name"`
	SessionID   string `json:"session_id"`
	SessionName string `json:"session_name"`
}

type clickhouseHookRow struct {
	EventTimeMS string `json:"event_time_ms"`
	EventName   string `json:"event_name"`
	SessionID   string `json:"session_id"`
	SessionName string `json:"session_name"`
}

func main() {
	s := &server{
		clickhouseURL: strings.TrimRight(env("CLICKHOUSE_URL", "http://localhost:8123"), "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	if err := s.ensureSchema(context.Background()); err != nil {
		log.Fatalf("clickhouse schema: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/hooks", s.handleHooks)

	addr := ":" + env("PORT", "4000")
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, logRequest(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) handleIndex(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	_, _ = w.Write(indexHTML)
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("allow", http.MethodGet)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}

	if err := s.exec(r.Context(), "SELECT 1"); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":         false,
			"clickhouse": "unavailable",
			"detail":     err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "clickhouse": "ok"})
}

func (s *server) handleHooks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listHooks(w, r)
	case http.MethodPost:
		s.createHook(w, r)
	default:
		w.Header().Set("allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
	}
}

func (s *server) createHook(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "read body"})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}

	eventName := firstString(payload, "hook_event_name", "event_name", "event", "name")
	if eventName == "" {
		eventName = "Unknown"
	}

	sessionID := sessionIdentifier(payload)
	sessionName := sessionLabel(payload, sessionID)

	row := map[string]string{
		"event_name":   eventName,
		"session_id":   sessionID,
		"session_name": sessionName,
		"payload":      string(body),
	}

	rowJSON, err := json.Marshal(row)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "encode row"})
		return
	}

	query := "INSERT INTO claude_hooks (event_name, session_id, session_name, payload) FORMAT JSONEachRow"
	if err := s.query(r.Context(), query, append(rowJSON, '\n')); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "insert failed", "detail": err.Error()})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":           true,
		"event_name":   eventName,
		"session_id":   sessionID,
		"session_name": sessionName,
	})
}

func (s *server) listHooks(w http.ResponseWriter, r *http.Request) {
	limit := r.URL.Query().Get("limit")
	query := fmt.Sprintf(`
		SELECT
			toUnixTimestamp64Milli(event_time) AS event_time_ms,
			event_name,
			session_id,
			if(session_name = '', session_id, session_name) AS session_name
		FROM claude_hooks
		ORDER BY event_time DESC
		LIMIT %d
		FORMAT JSONEachRow
	`, clickhouseUInt(limit, 200))

	data, err := s.queryBytes(r.Context(), query, nil)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "query failed", "detail": err.Error()})
		return
	}

	rows := make([]hookRow, 0)
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), 5<<20)
	for scanner.Scan() {
		var row clickhouseHookRow
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "decode row", "detail": err.Error()})
			return
		}
		eventTime, err := strconv.ParseInt(row.EventTimeMS, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "decode event time", "detail": err.Error()})
			return
		}

		rows = append(rows, hookRow{
			EventTime:   time.UnixMilli(eventTime).UTC().Format(time.RFC3339Nano),
			EventName:   row.EventName,
			SessionID:   row.SessionID,
			SessionName: row.SessionName,
		})
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
			CREATE TABLE IF NOT EXISTS claude_hooks (
				event_time DateTime64(3) DEFAULT now64(3),
				event_name String,
				session_id String,
				session_name String,
				payload String
			) ENGINE = MergeTree
			ORDER BY (event_time, session_id, event_name)
		`)
		if err == nil {
			return s.exec(deadline, "ALTER TABLE claude_hooks ADD COLUMN IF NOT EXISTS session_name String AFTER session_id")
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
		return nil, fmt.Errorf("clickhouse %s: %s", resp.Status, msg)
	}
	if readErr != nil {
		return nil, readErr
	}

	return data, nil
}

func sessionIdentifier(payload map[string]any) string {
	if value := firstString(payload, "session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"); value != "" {
		return value
	}

	if transcriptPath := firstString(payload, "transcript_path", "transcriptPath"); transcriptPath != "" {
		return strings.TrimSuffix(filepath.Base(transcriptPath), filepath.Ext(transcriptPath))
	}

	if cwd := firstString(payload, "cwd", "workspace", "repository", "repo"); cwd != "" {
		return filepath.Base(cwd)
	}

	return "unknown"
}

func sessionLabel(payload map[string]any, sessionID string) string {
	if value := firstString(payload, "session_name", "sessionName", "session_title", "sessionTitle", "conversation_name", "conversationName"); value != "" {
		return value
	}

	if cwd := firstString(payload, "cwd", "workspace", "repository", "repo"); cwd != "" {
		return filepath.Base(cwd)
	}

	if sessionID != "" && sessionID != "unknown" {
		return shortID(sessionID)
	}

	return "Unknown session"
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}

		switch typed := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				return trimmed
			}
		case fmt.Stringer:
			if trimmed := strings.TrimSpace(typed.String()); trimmed != "" {
				return trimmed
			}
		}
	}

	return ""
}

func shortID(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:8] + "..." + value[len(value)-4:]
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json: %v", err)
	}
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
