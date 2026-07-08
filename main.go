package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
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

// maxReadBytes caps the size of incoming hook POST bodies.
const maxReadBytes = 5 << 20

// maxStringBytes caps individual string fields we surface in summaries.
// The full payload is always available via /api/hooks/{event_id}.
const maxStringBytes = 8 << 10

// maxListBytes caps the per-line response size when scanning JSONEachRow.
const maxLineBytes = 8 << 20

// Normalized "kind" values used by the UI.
const (
	kindUserPrompt    = "user_prompt"
	kindAssistantStop = "assistant_stop"
	kindTool          = "tool"
	kindSessionStart  = "session_start"
	kindSessionEnd    = "session_end"
	kindNotification  = "notification"
	kindPermissionReq = "permission_request"
	kindCompact       = "compact"
	kindOther         = "other"
)

// Status values for tool events.
const (
	statusOK      = "ok"
	statusError   = "error"
	statusPending = "pending"
)

type server struct {
	clickhouseURL string
	httpClient    *http.Client
}

// hookEvent is a single row from ClickHouse with its payload parsed.
type hookEvent struct {
	EventID     string
	EventTime   time.Time
	EventName   string
	SessionID   string
	SessionName string
	ToolUseID   string
	Payload     map[string]any
}

// eventSummary is a derived, lightweight view of an event.
// It carries enough detail for both the compact and expanded UI levels.
type eventSummary struct {
	EventID        string         `json:"event_id"`
	EventTime      string         `json:"event_time"`
	EndTime        string         `json:"end_time,omitempty"`
	Kind           string         `json:"kind"`
	EventName      string         `json:"event_name"`
	SessionID      string         `json:"session_id"`
	SessionName    string         `json:"session_name"`
	ToolName       string         `json:"tool_name,omitempty"`
	ToolUseID      string         `json:"tool_use_id,omitempty"`
	Summary        string         `json:"summary"`
	Status         string         `json:"status,omitempty"`
	DurationMS     *int64         `json:"duration_ms,omitempty"`
	Input          map[string]any `json:"input,omitempty"`
	Output         map[string]any `json:"output,omitempty"`
	Content        string         `json:"content,omitempty"`
	PermissionMode string         `json:"permission_mode,omitempty"`
	Effort         string         `json:"effort,omitempty"`
	Error          string         `json:"error,omitempty"`
	ContextTokens  int64          `json:"context_tokens,omitempty"`
	ContextWindow  int64          `json:"context_window,omitempty"`
}

type contextSnapshot struct {
	At         time.Time
	Tokens     int64
	Window     int64
	AfterEvent bool
}

type cachedContextSnapshots struct {
	Size      int64
	Modified  time.Time
	Snapshots []contextSnapshot
}

var contextSnapshotCache = struct {
	sync.RWMutex
	entries map[string]cachedContextSnapshots
}{entries: make(map[string]cachedContextSnapshots)}

// sessionSummary aggregates a single session's stats for the header and sidebar.
type sessionSummary struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	StartedAt    string `json:"started_at"`
	EndedAt      string `json:"ended_at"`
	DurationMS   int64  `json:"duration_ms"`
	TurnCount    int    `json:"turn_count"`
	ToolCount    int    `json:"tool_count"`
	EventCount   int    `json:"event_count"`
	FailureCount int    `json:"failure_count"`
}

// turn groups a prompt, the tools that happened while answering it,
// and the final assistant stop.
type turn struct {
	StartedAt string         `json:"started_at"`
	EndedAt   string         `json:"ended_at"`
	Prompt    *eventSummary  `json:"prompt,omitempty"`
	Tools     []eventSummary `json:"tools"`
	Notes     []eventSummary `json:"notes,omitempty"`
	Response  *eventSummary  `json:"response,omitempty"`
}

type timelineResponse struct {
	Session sessionSummary `json:"session"`
	Turns   []turn         `json:"turns"`
}

type hookDetailResponse struct {
	EventID   string         `json:"event_id"`
	EventTime string         `json:"event_time"`
	EventName string         `json:"event_name"`
	SessionID string         `json:"session_id"`
	Payload   map[string]any `json:"payload"`
}

func main() {
	s := &server{
		clickhouseURL: strings.TrimRight(env("CLICKHOUSE_URL", "http://localhost:8123"), "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	if err := s.ensureSchema(context.Background()); err != nil {
		log.Fatalf("clickhouse schema: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/hooks", s.handleHooksCollection)
	mux.HandleFunc("/api/hooks/", s.handleHookByID)
	mux.HandleFunc("/api/sessions/", s.handleSessionRoute)

	addr := ":" + env("PORT", "4000")
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, logRequest(mux)); err != nil {
		log.Fatal(err)
	}
}

// --- HTTP handlers ---

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

func (s *server) handleHooksCollection(w http.ResponseWriter, r *http.Request) {
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

func (s *server) handleHookByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("allow", http.MethodGet)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	rawID := strings.TrimPrefix(r.URL.EscapedPath(), "/api/hooks/")
	eventID, err := url.PathUnescape(rawID)
	if err != nil || strings.TrimSpace(eventID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "event id is required"})
		return
	}
	s.serveHookDetail(w, r, eventID)
}

func (s *server) handleSessionRoute(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.EscapedPath(), "/api/sessions/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "session id is required"})
		return
	}
	sessionID, err := url.PathUnescape(parts[0])
	if err != nil || strings.TrimSpace(sessionID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "session id is required"})
		return
	}

	if len(parts) == 2 && parts[1] == "timeline" {
		if r.Method != http.MethodGet {
			w.Header().Set("allow", http.MethodGet)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		s.serveSessionTimeline(w, r, sessionID)
		return
	}

	if r.Method == http.MethodDelete {
		s.deleteSession(w, r, sessionID)
		return
	}
	w.Header().Set("allow", "DELETE")
	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
}

// hookRowProjection is the column set used by every hook SELECT.
const hookRowProjection = `
	toUnixTimestamp64Milli(event_time) AS event_time_ms,
	event_id,
	event_name,
	session_id,
	if(session_name = '', session_id, session_name) AS session_name,
	JSONExtractString(payload, 'tool_use_id') AS tool_use_id,
	event_natural_id,
	payload
`

func (s *server) listHooks(w http.ResponseWriter, r *http.Request) {
	limit := clickhouseUInt(r.URL.Query().Get("limit"), 200)
	query := fmt.Sprintf(`
		SELECT %s
		FROM claude_hooks
		ORDER BY event_time DESC
		LIMIT %d
		FORMAT JSONEachRow
	`, hookRowProjection, limit)

	events, err := s.loadEvents(r.Context(), query, nil)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "query failed", "detail": err.Error()})
		return
	}
	summaries := buildSummaries(events)
	writeJSON(w, http.StatusOK, map[string]any{"hooks": summaries})
}

func (s *server) serveHookDetail(w http.ResponseWriter, r *http.Request, eventID string) {
	// Match either the synthetic UUID (event_id column) or the deterministic
	// natural_id (which is what the list endpoint returns for legacy rows
	// whose UUIDs were re-randomized on every read).
	query := fmt.Sprintf(`
		SELECT %s
		FROM claude_hooks
		WHERE event_id = {event_id:String}
		   OR event_natural_id = {event_id:String}
		LIMIT 1
		FORMAT JSONEachRow
	`, hookRowProjection)
	data, err := s.queryBytesWithParams(r.Context(), query, nil, url.Values{"param_event_id": []string{eventID}})
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "query failed", "detail": err.Error()})
		return
	}
	line := strings.TrimSpace(string(data))
	if line == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "event not found"})
		return
	}
	var row hookRow
	if err := json.Unmarshal([]byte(line), &row); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "decode row", "detail": err.Error()})
		return
	}
	event, err := row.toHookEvent()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "decode row", "detail": err.Error()})
		return
	}
	if event.EventID == "" {
		event.EventID = fallbackEventID(event)
	}
	writeJSON(w, http.StatusOK, hookDetailResponse{
		EventID:   event.EventID,
		EventTime: event.EventTime.UTC().Format(time.RFC3339Nano),
		EventName: event.EventName,
		SessionID: event.SessionID,
		Payload:   event.Payload,
	})
}

func (s *server) serveSessionTimeline(w http.ResponseWriter, r *http.Request, sessionID string) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM claude_hooks
		WHERE session_id = {session_id:String}
		ORDER BY event_time ASC
		LIMIT 5000
		FORMAT JSONEachRow
	`, hookRowProjection)
	params := url.Values{"param_session_id": []string{sessionID}}
	events, err := s.loadEvents(r.Context(), query, params)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "query failed", "detail": err.Error()})
		return
	}
	summaries := buildSummaries(events)
	timeline := buildTimeline(summaries)
	writeJSON(w, http.StatusOK, timeline)
}

func (s *server) deleteSession(w http.ResponseWriter, r *http.Request, sessionID string) {
	query := `
		ALTER TABLE claude_hooks
		DELETE WHERE session_id = {session_id:String}
		SETTINGS mutations_sync = 1
	`
	params := url.Values{"param_session_id": []string{sessionID}}
	if err := s.queryWithParams(r.Context(), query, params); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "delete failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session_id": sessionID})
}

func (s *server) createHook(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, maxReadBytes))
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
	toolUseID := firstString(payload, "tool_use_id", "toolUseId")
	// Pin event_time in Go so the natural_id (which is hashed over it)
	// matches the value the database actually stores. The schema default
	// is now64(3) on the server clock; if we let it default and compute
	// the hash from time.Now(), the two can drift by a few ms and the
	// stored natural_id won't match what computeNaturalID would predict.
	eventTime := time.Now().UTC()
	naturalID := computeNaturalID(sessionID, eventName, toolUseID, eventTime)
	row := map[string]any{
		"event_time":       eventTime.Format("2006-01-02 15:04:05.000"),
		"event_name":       eventName,
		"session_id":       sessionID,
		"session_name":     sessionName,
		"event_natural_id": naturalID,
		"payload":          string(body),
	}
	rowJSON, err := json.Marshal(row)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "encode row"})
		return
	}
	query := "INSERT INTO claude_hooks (event_time, event_name, session_id, session_name, event_natural_id, payload) FORMAT JSONEachRow"
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

// --- Schema ---

func (s *server) ensureSchema(ctx context.Context) error {
	deadline, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	create := `
		CREATE TABLE IF NOT EXISTS claude_hooks (
			event_time DateTime64(3) DEFAULT now64(3),
			event_id String DEFAULT generateUUIDv4(),
			event_name String,
			session_id String,
			session_name String,
			payload String,
			event_natural_id String DEFAULT ''
		) ENGINE = MergeTree
		ORDER BY (event_time, session_id, event_name)
	`
	if err := s.exec(deadline, create); err != nil {
		return fmt.Errorf("create table: %w", err)
	}

	// Additive migrations. Each statement is idempotent.
	add := []string{
		`ALTER TABLE claude_hooks ADD COLUMN IF NOT EXISTS event_id String DEFAULT generateUUIDv4()`,
		`ALTER TABLE claude_hooks ADD COLUMN IF NOT EXISTS session_name String AFTER session_id`,
		`ALTER TABLE claude_hooks ADD COLUMN IF NOT EXISTS event_natural_id String DEFAULT ''`,
	}
	for _, stmt := range add {
		if err := s.exec(deadline, stmt); err != nil {
			return fmt.Errorf("migrate: %w (%s)", err, oneLine(stmt))
		}
	}

	// Backfill event_natural_id for any rows that don't have it yet. The
	// natural ID is a deterministic SHA-256 of the natural key, computed
	// in ClickHouse so the formula stays in lockstep with computeNaturalID
	// in Go. This is a single mutation, not a per-row loop, so it doesn't
	// hammer the server and survives the 60s ensureSchema deadline even
	// on large legacy datasets.
	if err := s.backfillNaturalIDs(deadline); err != nil {
		log.Printf("natural_id backfill failed: %v", err)
	}
	return nil
}

// backfillNaturalIDs populates event_natural_id for rows that don't have one.
// Implemented as a single ClickHouse mutation whose target is keyed on
// event_natural_id (the column being filled), not on event_id. This is
// critical: for legacy rows added via ALTER TABLE ... ADD COLUMN ... DEFAULT
// generateUUIDv4(), ClickHouse re-randomizes the UUID at read time, so a
// predicate on event_id would never match the row we just SELECTed. The
// WHERE clause must use the column being mutated.
//
// The hash includes event_time (as a millisecond integer) so the natural_id
// is one-per-row, not one-per-(session,name,tool_use_id). The formula must
// stay byte-for-byte identical to computeNaturalID in Go.
//
// The query is a single line — multi-line variants trip the ClickHouse
// parser (the `(` count gets miscounted past the newlines).
func (s *server) backfillNaturalIDs(ctx context.Context) error {
	query := `ALTER TABLE claude_hooks UPDATE event_natural_id = concat('legacy-', substring(lower(hex(SHA256(concat(session_id, '|', event_name, '|', JSONExtractString(payload, 'tool_use_id'), '|', toString(toUnixTimestamp64Milli(event_time)))))), 1, 24)) WHERE event_natural_id = '' SETTINGS mutations_sync = 1`
	if err := s.queryWithParams(ctx, query, nil); err != nil {
		return err
	}
	return nil
}

// --- ClickHouse helpers ---

type hookRow struct {
	EventTimeMS    string `json:"event_time_ms"`
	EventID        string `json:"event_id"`
	EventName      string `json:"event_name"`
	SessionID      string `json:"session_id"`
	SessionName    string `json:"session_name"`
	ToolUseID      string `json:"tool_use_id"`
	EventNaturalID string `json:"event_natural_id"`
	Payload        string `json:"payload"`
}

func (r hookRow) toHookEvent() (*hookEvent, error) {
	eventTime, err := strconv.ParseInt(r.EventTimeMS, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("decode event time: %w", err)
	}
	var payload map[string]any
	if r.Payload != "" {
		if err := json.Unmarshal([]byte(r.Payload), &payload); err != nil {
			return nil, fmt.Errorf("decode payload: %w", err)
		}
	}
	// Prefer the natural_id. It's deterministic, so the same row gets the
	// same public ID across re-reads (and across re-inserts if the same
	// hook fires twice). The synthetic UUID is only used as a last resort
	// for rows that predate the natural_id column entirely.
	id := r.EventNaturalID
	if id == "" {
		id = r.EventID
	}
	return &hookEvent{
		EventID:     id,
		EventTime:   time.UnixMilli(eventTime).UTC(),
		EventName:   r.EventName,
		SessionID:   r.SessionID,
		SessionName: r.SessionName,
		ToolUseID:   r.ToolUseID,
		Payload:     payload,
	}, nil
}

func (s *server) loadEvents(ctx context.Context, query string, params url.Values) ([]*hookEvent, error) {
	data, err := s.queryBytesWithParams(ctx, query, nil, params)
	if err != nil {
		return nil, err
	}
	var events []*hookEvent
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), maxLineBytes)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var row hookRow
		if err := json.Unmarshal(line, &row); err != nil {
			return nil, fmt.Errorf("decode row: %w", err)
		}
		event, err := row.toHookEvent()
		if err != nil {
			return nil, err
		}
		if event.EventID == "" {
			event.EventID = fallbackEventID(event)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan rows: %w", err)
	}
	return events, nil
}

func (s *server) exec(ctx context.Context, query string) error {
	return s.query(ctx, query, nil)
}

func (s *server) query(ctx context.Context, query string, body []byte) error {
	_, err := s.queryBytes(ctx, query, body)
	return err
}

func (s *server) queryWithParams(ctx context.Context, query string, params url.Values) error {
	_, err := s.queryBytesWithParams(ctx, query, nil, params)
	return err
}

func (s *server) queryBytes(ctx context.Context, query string, body []byte) ([]byte, error) {
	return s.queryBytesWithParams(ctx, query, body, nil)
}

func (s *server) queryBytesWithParams(ctx context.Context, query string, body []byte, params url.Values) ([]byte, error) {
	if params == nil {
		params = make(url.Values)
	}
	params.Set("query", strings.TrimSpace(query))
	endpoint := s.clickhouseURL + "/?" + params.Encode()
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

// --- Summary builders ---

// buildSummaries takes raw events (any order) and returns merged summaries
// in chronological order (oldest first). Pre/Post tool events are paired by
// tool_use_id and emitted as a single entry.
func buildSummaries(events []*hookEvent) []eventSummary {
	if len(events) == 0 {
		return nil
	}
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].EventTime.Before(events[j].EventTime)
	})

	// Pair Pre/Post tool events by tool_use_id. toolUseIDOf pulls the field
	// from the payload when the dedicated column wasn't populated.
	pres := make(map[string]*hookEvent)
	posts := make(map[string]*hookEvent)
	for _, e := range events {
		switch e.EventName {
		case "PreToolUse":
			if id := toolUseIDOf(e); id != "" {
				pres[id] = e
			}
		case "PostToolUse":
			if id := toolUseIDOf(e); id != "" {
				posts[id] = e
			}
		}
	}

	out := make([]eventSummary, 0, len(events))
	emitted := make(map[string]bool) // tool_use_id already merged

	// Walk chronologically and emit each tool pair when we first see it.
	// The emitted entry preserves the position of whichever event in the
	// pair was seen first.
	for _, e := range events {
		switch e.EventName {
		case "PreToolUse", "PostToolUse":
			id := toolUseIDOf(e)
			if id == "" || emitted[id] {
				continue
			}
			emitted[id] = true
			out = append(out, buildToolSummary(pres[id], posts[id]))
		default:
			out = append(out, buildNonToolSummary(e))
		}
	}
	attachContextUsage(out, events)
	return out
}

// attachContextUsage enriches tool rows with the context-window snapshot from
// the Codex or Claude transcript referenced by the hook payload.
func attachContextUsage(summaries []eventSummary, events []*hookEvent) {
	paths := make(map[string]string)
	for _, event := range events {
		if paths[event.SessionID] != "" {
			continue
		}
		paths[event.SessionID] = stringFromPayload(event.Payload, "transcript_path")
	}

	snapshotsByPath := make(map[string][]contextSnapshot)
	for i := range summaries {
		summary := &summaries[i]
		if summary.Kind != kindTool {
			continue
		}
		rawPath := paths[summary.SessionID]
		if rawPath == "" {
			continue
		}
		snapshots, ok := snapshotsByPath[rawPath]
		if !ok {
			snapshots = readContextSnapshots(rawPath)
			snapshotsByPath[rawPath] = snapshots
		}
		if len(snapshots) == 0 {
			continue
		}

		startAt, err := time.Parse(time.RFC3339Nano, summary.EventTime)
		if err != nil {
			continue
		}
		index := -1
		if snapshots[0].AfterEvent {
			endAt, parseErr := time.Parse(time.RFC3339Nano, summary.endTimeOrTime())
			if parseErr != nil {
				continue
			}
			candidate := sort.Search(len(snapshots), func(j int) bool {
				return !snapshots[j].At.Before(endAt)
			})
			if candidate < len(snapshots) {
				index = candidate
			}
		} else {
			// Claude records usage on the assistant message that issued the tool,
			// immediately before the PreToolUse hook.
			candidate := sort.Search(len(snapshots), func(j int) bool {
				return snapshots[j].At.After(startAt)
			})
			if candidate > 0 {
				index = candidate - 1
			}
		}
		if index < 0 || index >= len(snapshots) {
			continue
		}
		summary.ContextTokens = snapshots[index].Tokens
		summary.ContextWindow = snapshots[index].Window
	}
}

func readContextSnapshots(rawPath string) []contextSnapshot {
	path, ok := allowedTranscriptPath(rawPath)
	if !ok {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	contextSnapshotCache.RLock()
	cached, found := contextSnapshotCache.entries[path]
	contextSnapshotCache.RUnlock()
	if found && cached.Size == info.Size() && cached.Modified.Equal(info.ModTime()) {
		return cached.Snapshots
	}
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	var snapshots []contextSnapshot
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64<<10), 64<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		isCodex := bytes.Contains(line, []byte(`"type":"token_count"`))
		isClaude := bytes.Contains(line, []byte(`"usage":`)) && bytes.Contains(line, []byte(`"role":"assistant"`))
		if !isCodex && !isClaude {
			continue
		}
		var entry struct {
			Timestamp string `json:"timestamp"`
			Payload   struct {
				Type string `json:"type"`
				Info struct {
					LastTokenUsage struct {
						InputTokens           int64 `json:"input_tokens"`
						CachedInputTokens     int64 `json:"cached_input_tokens"`
						OutputTokens          int64 `json:"output_tokens"`
						ReasoningOutputTokens int64 `json:"reasoning_output_tokens"`
						TotalTokens           int64 `json:"total_tokens"`
					} `json:"last_token_usage"`
					ModelContextWindow int64 `json:"model_context_window"`
				} `json:"info"`
			} `json:"payload"`
			Message struct {
				Role  string `json:"role"`
				Model string `json:"model"`
				Usage struct {
					InputTokens         int64 `json:"input_tokens"`
					CacheCreationTokens int64 `json:"cache_creation_input_tokens"`
					CacheReadTokens     int64 `json:"cache_read_input_tokens"`
					OutputTokens        int64 `json:"output_tokens"`
				} `json:"usage"`
			} `json:"message"`
		}
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, entry.Timestamp)
		if err != nil {
			continue
		}
		var snapshot contextSnapshot
		if isCodex && entry.Payload.Type == "token_count" {
			usage := entry.Payload.Info.LastTokenUsage
			tokens := usage.TotalTokens
			if tokens <= 0 {
				// Fallback when total_tokens is unset; cached_input_tokens is
				// included so a future Codex revision that omits total_tokens
				// but populates the cache field is still counted accurately.
				tokens = usage.InputTokens + usage.CachedInputTokens + usage.OutputTokens + usage.ReasoningOutputTokens
			}
			snapshot = contextSnapshot{
				At:         at,
				Tokens:     tokens,
				Window:     entry.Payload.Info.ModelContextWindow,
				AfterEvent: true,
			}
		} else if isClaude && entry.Message.Role == "assistant" {
			usage := entry.Message.Usage
			snapshot = contextSnapshot{
				At:     at,
				Tokens: usage.InputTokens + usage.CacheCreationTokens + usage.CacheReadTokens,
				Window: claudeContextWindow(entry.Message.Model),
			}
		}
		if snapshot.Tokens <= 0 || snapshot.Window <= 0 {
			continue
		}
		snapshots = append(snapshots, snapshot)
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].At.Before(snapshots[j].At) })
	if scanner.Err() != nil {
		return nil
	}
	contextSnapshotCache.Lock()
	contextSnapshotCache.entries[path] = cachedContextSnapshots{
		Size:      info.Size(),
		Modified:  info.ModTime(),
		Snapshots: snapshots,
	}
	contextSnapshotCache.Unlock()
	return snapshots
}

// allowedTranscriptPath validates that rawPath is a `.jsonl` file inside one
// of the configured transcript roots. Both the root and the path are
// resolved with `filepath.Abs` + `EvalSymlinks` so symlinked transcripts are
// compared against their real root. A root that fails to resolve to an
// absolute path (e.g. when `os.UserHomeDir()` returns "" in a minimal
// container and no env-var override is set) is treated as untrusted and
// never grants access — this blocks the CWD-relative symlink escape where
// an attacker plants `.codex/sessions` in the binary's working directory.
func allowedTranscriptPath(rawPath string) (string, bool) {
	home, _ := os.UserHomeDir()
	defaults := []string{
		filepath.Join(home, ".codex", "sessions"),
		filepath.Join(home, ".claude", "projects"),
	}
	roots := []string{
		firstNonEmpty(strings.TrimSpace(os.Getenv("TRACEFRAME_TRANSCRIPT_ROOT")), defaults[0]),
		firstNonEmpty(strings.TrimSpace(os.Getenv("TRACEFRAME_CLAUDE_TRANSCRIPT_ROOT")), defaults[1]),
	}
	path, err := filepath.Abs(filepath.Clean(rawPath))
	if err != nil {
		return "", false
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", false
	}
	if filepath.Ext(path) != ".jsonl" {
		return "", false
	}
	for _, rawRoot := range roots {
		abs, rootErr := filepath.Abs(rawRoot)
		if rootErr != nil || !filepath.IsAbs(abs) {
			continue
		}
		root, rootErr := filepath.EvalSymlinks(abs)
		if rootErr != nil {
			continue
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return path, true
		}
	}
	return "", false
}

// claudeContextWindow returns the 1M-token context window for Claude Opus
// 4.8 and falls back to TRACEFRAME_CLAUDE_CONTEXT_WINDOW (default 200_000)
// for everything else. The Opus match is anchored so it does not pick up
// hypothetical siblings like `claude-opus-4-80` or `claude-opus-4-8-preview`.
func claudeContextWindow(model string) int64 {
	normalized := strings.ToLower(strings.TrimSpace(model))
	if isClaudeOpus48(normalized) {
		return 1_000_000
	}
	if configured := strings.TrimSpace(os.Getenv("TRACEFRAME_CLAUDE_CONTEXT_WINDOW")); configured != "" {
		if value, err := strconv.ParseInt(configured, 10, 64); err == nil && value > 0 {
			return value
		}
	}
	return 200_000
}

func isClaudeOpus48(normalized string) bool {
	const prefix = "claude-opus-4-8"
	if !strings.HasPrefix(normalized, prefix) {
		return false
	}
	rest := normalized[len(prefix):]
	if rest == "" {
		return true
	}
	// Accept a date suffix (`claude-opus-4-8-YYYYMMDD`) and reject any
	// other token continuation like `-preview`, `-80`, or `-next`.
	if rest[0] != '-' {
		return false
	}
	for _, c := range rest[1:] {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func toolUseIDOf(e *hookEvent) string {
	if e.ToolUseID != "" {
		return e.ToolUseID
	}
	return stringFromPayload(e.Payload, "tool_use_id")
}

func buildNonToolSummary(e *hookEvent) eventSummary {
	s := eventSummary{
		EventID:     e.EventID,
		EventTime:   e.EventTime.UTC().Format(time.RFC3339Nano),
		Kind:        classifyEvent(e.EventName),
		EventName:   e.EventName,
		SessionID:   e.SessionID,
		SessionName: e.SessionName,
	}
	s.PermissionMode = stringFromPayload(e.Payload, "permission_mode")
	s.Effort = extractEffort(e.Payload)
	switch s.Kind {
	case kindUserPrompt:
		s.Content = truncate(stringFromPayload(e.Payload, "prompt"), maxStringBytes)
		s.Summary = "You"
		// First line as a one-liner preview.
		if first := firstLine(s.Content); first != "" {
			s.Summary = "You: " + truncate(first, 120)
		}
	case kindAssistantStop:
		s.Content = truncate(stringFromPayload(e.Payload, "last_assistant_message"), maxStringBytes)
		s.Summary = "Assistant"
		if stopActive, ok := e.Payload["stop_hook_active"].(bool); ok && stopActive {
			s.Summary = "Assistant"
		}
		if s.Content != "" {
			if first := firstLine(s.Content); first != "" {
				s.Summary = "Assistant: " + truncate(first, 120)
			}
		}
	case kindSessionStart:
		s.Summary = "Session started"
	case kindSessionEnd:
		reason := stringFromPayload(e.Payload, "reason")
		if reason != "" {
			s.Summary = "Session ended: " + reason
		} else {
			s.Summary = "Session ended"
		}
	case kindNotification:
		msg := stringFromPayload(e.Payload, "message")
		if msg == "" {
			msg = stringFromPayload(e.Payload, "notification")
		}
		s.Summary = "Notification"
		if msg != "" {
			s.Summary = "Notification: " + truncate(msg, 120)
		}
	case kindPermissionReq:
		toolName := stringFromPayload(e.Payload, "tool_name")
		s.ToolName = toolName
		s.Summary = "Permission request"
		if toolName != "" {
			s.Summary = "Permission: " + toolName
		}
	case kindCompact:
		s.Summary = "Compact context"
		if trigger := stringFromPayload(e.Payload, "trigger"); trigger != "" {
			s.Summary = "Compact: " + trigger
		}
	default:
		s.Summary = e.EventName
	}
	return s
}

func buildToolSummary(pre, post *hookEvent) eventSummary {
	// Source the tool name and inputs from the Pre (user intent), and the
	// response and timing from the Post (system reply). When one is
	// missing, fall back to the other.
	var toolName, toolUseID string
	var input map[string]any
	var cwd string
	if pre != nil {
		toolName = firstNonEmpty(
			stringFromPayload(pre.Payload, "tool_name"),
			postToolName(post),
		)
		input = mapFromPayload(pre.Payload, "tool_input")
		toolUseID = firstNonEmpty(pre.ToolUseID, stringFromPayload(pre.Payload, "tool_use_id"))
		cwd = stringFromPayload(pre.Payload, "cwd")
	}
	if post != nil {
		if toolName == "" {
			toolName = stringFromPayload(post.Payload, "tool_name")
		}
		if toolUseID == "" {
			toolUseID = firstNonEmpty(post.ToolUseID, stringFromPayload(post.Payload, "tool_use_id"))
		}
		if cwd == "" {
			cwd = stringFromPayload(post.Payload, "cwd")
		}
	}

	start := eventTime(pre, post)
	end := eventTime(post, pre)
	summary := buildToolOneLiner(toolName, input, post, cwd)
	status, statusErr, statusHint := computeStatus(toolName, post)
	processedInput := processInput(input, cwd)
	processedOutput := processOutput(toolName, post, status, statusErr, statusHint, cwd)

	var dur *int64
	if pre != nil && post != nil {
		d := post.EventTime.Sub(pre.EventTime).Milliseconds()
		if d < 0 {
			d = 0
		}
		dur = &d
	}

	s := eventSummary{
		EventID:     pickEventID(pre, post),
		EventTime:   start.UTC().Format(time.RFC3339Nano),
		Kind:        kindTool,
		EventName:   "PreToolUse+PostToolUse",
		SessionID:   pickSessionID(pre, post),
		SessionName: pickSessionName(pre, post),
		ToolName:    toolName,
		ToolUseID:   toolUseID,
		Summary:     summary,
		Status:      status,
		DurationMS:  dur,
		Input:       processedInput,
		Output:      processedOutput,
	}
	if pre != nil {
		s.PermissionMode = stringFromPayload(pre.Payload, "permission_mode")
		s.Effort = extractEffort(pre.Payload)
	}
	if post != nil && (s.PermissionMode == "" || s.Effort == "") {
		if s.PermissionMode == "" {
			s.PermissionMode = stringFromPayload(post.Payload, "permission_mode")
		}
		if s.Effort == "" {
			s.Effort = extractEffort(post.Payload)
		}
	}
	if end.After(start) {
		s.EndTime = end.UTC().Format(time.RFC3339Nano)
	}
	if statusErr != "" {
		s.Error = statusErr
	}
	if pre == nil && post != nil {
		// Orphan post: surface that we missed the Pre.
		if s.Summary == toolName || s.Summary == "Tool" {
			s.Summary = toolName + " (no Pre)"
		}
	}
	return s
}

// buildToolOneLiner creates a single-line description for the compact row.
// Examples:
//   "Edit static/index.html +3/-2"
//   "Read README.md lines 1-120"
//   "Bash Build application"
//   "Write main.go 50 lines"
func buildToolOneLiner(toolName string, input map[string]any, post *hookEvent, cwd string) string {
	switch toolName {
	case "Edit", "MultiEdit":
		file := relativizePath(stringFromMap(input, "file_path"), cwd)
		if post != nil {
			if res := mapFromPayload(post.Payload, "tool_response"); res != nil {
				if add, rem, ok := patchStats(res); ok {
					if file != "" {
						return fmt.Sprintf("%s %s +%d/-%d", toolName, file, add, rem)
					}
					return fmt.Sprintf("%s +%d/-%d", toolName, add, rem)
				}
			}
		}
		if file != "" {
			return toolName + " " + file
		}
	case "Read":
		file := relativizePath(stringFromMap(input, "file_path"), cwd)
		res := mapFromPayload(postPayload(post), "tool_response")
		if file == "" && res != nil {
			if fp := extractReadFilePath(res); fp != "" {
				file = relativizePath(fp, cwd)
			}
		}
		// `offset` is 0-based (line 0 is the first line of the file). The
		// compact row should report 1-based inclusive line numbers like the
		// file viewer would.
		startLine := numberFromMap(input, "offset") // 0-based
		limit := numberFromMap(input, "limit")
		lines := readNumLines(res)
		if startLine == 0 && limit == 0 && lines > 0 {
			// No explicit range; the response tells us the total.
			if file != "" {
				return fmt.Sprintf("Read %s (%d lines)", file, lines)
			}
		}
		if startLine > 0 || limit > 0 {
			// Convert to 1-based: firstLine = startLine+1, lastLine = startLine+lines.
			firstLine := startLine + 1
			lastLine := startLine + lines
			if lastLine <= firstLine {
				lastLine = startLine + limit
			}
			if file != "" {
				if lastLine > firstLine {
					return fmt.Sprintf("Read %s lines %d-%d", file, firstLine, lastLine)
				}
				return fmt.Sprintf("Read %s lines %d-…", file, firstLine)
			}
		}
		if file != "" {
			return "Read " + file
		}
	case "Write":
		file := relativizePath(stringFromMap(input, "file_path"), cwd)
		// Prefer the file path from the response (it has the absolute path).
		if post != nil {
			if res := mapFromPayload(post.Payload, "tool_response"); res != nil {
				if fp := stringFromMap(res, "filePath"); fp != "" {
					file = relativizePath(fp, cwd)
				}
				if n := numberFromMap(res, "numLines"); n > 0 {
					return fmt.Sprintf("Write %s %d lines", file, n)
				}
			}
		}
		if file != "" {
			return "Write " + file
		}
	case "Bash":
		if desc := stringFromMap(input, "description"); desc != "" {
			return "Bash " + truncate(desc, 80)
		}
		if cmd := stringFromMap(input, "command"); cmd != "" {
			return "Bash " + truncate(firstLine(cmd), 80)
		}
	case "Glob":
		if pattern := stringFromMap(input, "pattern"); pattern != "" {
			if path := stringFromMap(input, "path"); path != "" {
				return fmt.Sprintf("Glob %s in %s", pattern, path)
			}
			return "Glob " + pattern
		}
	case "Grep":
		if pattern := stringFromMap(input, "pattern"); pattern != "" {
			if path := stringFromMap(input, "path"); path != "" {
				return fmt.Sprintf("Grep %s in %s", pattern, path)
			}
			return "Grep " + pattern
		}
	case "WebFetch":
		if url := stringFromMap(input, "url"); url != "" {
			return "WebFetch " + truncate(url, 60)
		}
	case "WebSearch":
		if q := stringFromMap(input, "query"); q != "" {
			return "WebSearch " + truncate(q, 60)
		}
	case "Task":
		if desc := stringFromMap(input, "description"); desc != "" {
			return "Task " + truncate(desc, 80)
		}
	case "TodoWrite":
		return "TodoWrite"
	case "KillShell":
		if id := stringFromMap(input, "shell_id"); id != "" {
			return "KillShell " + id
		}
		return "KillShell"
	case "NotebookEdit":
		if path := stringFromMap(input, "notebook_path"); path != "" {
			return "NotebookEdit " + path
		}
	case "Agent":
		if desc := stringFromMap(input, "description"); desc != "" {
			return "Agent " + truncate(desc, 80)
		}
	}
	if toolName != "" {
		return toolName
	}
	return "Tool"
}

// processInput returns the structured input the UI renders in level 2.
func processInput(input map[string]any, cwd string) map[string]any {
	if input == nil {
		return nil
	}
	out := make(map[string]any, len(input))
	for k, v := range input {
		switch k {
		case "file_path":
			if s, ok := v.(string); ok {
				out[k] = relativizePath(s, cwd)
			} else {
				out[k] = v
			}
		case "notebook_path":
			if s, ok := v.(string); ok {
				out[k] = relativizePath(s, cwd)
			} else {
				out[k] = v
			}
		case "old_string", "new_string", "content", "command":
			if s, ok := v.(string); ok {
				out[k] = truncate(s, maxStringBytes)
			} else {
				out[k] = v
			}
		default:
			out[k] = v
		}
	}
	return out
}

// processOutput returns the structured output the UI renders in level 2.
// The Edit tool's "originalFile" (huge original blob) is intentionally
// dropped — the full payload is available via /api/hooks/{event_id}.
func processOutput(toolName string, post *hookEvent, status, statusErr, statusHint, cwd string) map[string]any {
	if post == nil {
		return map[string]any{"pending": true}
	}
	res, _ := post.Payload["tool_response"].(map[string]any)
	if res == nil {
		return nil
	}
	out := make(map[string]any, len(res))
	for k, v := range res {
		switch k {
		case "filePath":
			if s, ok := v.(string); ok {
				out[k] = relativizePath(s, cwd)
			} else {
				out[k] = v
			}
		case "originalFile", "userModified":
			// originalFile can be hundreds of KiB; userModified is a
			// cosmetic flag. Both are dropped from the summary.
		case "replaceAll":
			out[k] = v
		case "content":
			if s, ok := v.(string); ok {
				out[k] = truncate(s, maxStringBytes)
			} else {
				out[k] = v
			}
		case "structuredPatch":
			out[k] = v // full structuredPatch is bounded by the diff itself
		case "stdout", "stderr":
			if s, ok := v.(string); ok {
				out[k] = truncate(s, maxStringBytes)
			} else {
				out[k] = v
			}
		default:
			out[k] = v
		}
	}
	// Some tools (Read) nest their data under "file". Lift the relevant
	// fields to the top level so the UI can show them directly.
	if toolName == "Read" {
		if f, ok := res["file"].(map[string]any); ok {
			if out["filePath"] == nil {
				if fp, ok := f["filePath"].(string); ok {
					out["filePath"] = relativizePath(fp, cwd)
				}
			}
			if out["content"] == nil {
				if content, ok := f["content"].(string); ok {
					out["content"] = truncate(content, maxStringBytes)
				}
			}
			if out["numLines"] == nil {
				if n, ok := toInt64(f["numLines"]); ok {
					out["numLines"] = n
				}
			}
			if out["startLine"] == nil {
				if n, ok := toInt64(f["startLine"]); ok {
					out["startLine"] = n
				}
			}
			if out["totalLines"] == nil {
				if n, ok := toInt64(f["totalLines"]); ok {
					out["totalLines"] = n
				}
			}
		}
	}
	if statusHint != "" {
		out["status_hint"] = statusHint
	}
	return out
}

// extractEffort flattens the effort field, which is sometimes a plain
// string ("high") and sometimes a nested object ({"level":"high"}).
func extractEffort(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if s, ok := payload["effort"].(string); ok && s != "" {
		return s
	}
	if m, ok := payload["effort"].(map[string]any); ok {
		if s, ok := m["level"].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// extractReadFilePath handles the variable shape of the Read tool's
// response. Newer payloads nest the file under "file" while older ones put
// the path at the top level.
func extractReadFilePath(res map[string]any) string {
	if fp := stringFromMap(res, "filePath"); fp != "" {
		return fp
	}
	if f, ok := res["file"].(map[string]any); ok {
		if fp := stringFromMap(f, "filePath"); fp != "" {
			return fp
		}
	}
	return ""
}

// readNumLines pulls numLines from the response, looking in the standard
// and the "file" sub-object.
func readNumLines(res map[string]any) int64 {
	if res == nil {
		return 0
	}
	if n, ok := toInt64(res["numLines"]); ok {
		return n
	}
	if f, ok := res["file"].(map[string]any); ok {
		if n, ok := toInt64(f["numLines"]); ok {
			return n
		}
	}
	return 0
}

// computeStatus derives a status string from the tool response. We avoid
// searching the response text for "error" because that produces false
// positives.
func computeStatus(toolName string, post *hookEvent) (status, errMsg, hint string) {
	if post == nil {
		return statusPending, "", ""
	}
	res, _ := post.Payload["tool_response"].(map[string]any)
	switch toolName {
	case "Bash":
		// ExitCode == 0 is success; explicit interrupt or non-zero is error.
		if interrupted, _ := res["interrupted"].(bool); interrupted {
			return statusError, "interrupted", ""
		}
		if exit, ok := res["exitCode"]; ok {
			if n, ok := toInt64(exit); ok {
				if n != 0 {
					return statusError, fmt.Sprintf("exit %d", n), ""
				}
			}
		}
		return statusOK, "", ""
	case "Edit", "MultiEdit", "Write", "NotebookEdit":
		// If the response explicitly says success=false, that's an error.
		if success, ok := res["success"].(bool); ok {
			if !success {
				return statusError, "tool reported failure", ""
			}
		}
		return statusOK, "", ""
	case "Read", "Glob", "Grep":
		// These don't fail meaningfully; the response is the result.
		return statusOK, "", ""
	case "WebFetch", "WebSearch":
		// No standard success field; trust the response.
		return statusOK, "", ""
	default:
		if success, ok := res["success"].(bool); ok && !success {
			return statusError, "tool reported failure", ""
		}
		return statusOK, "", ""
	}
}

// buildTimeline groups merged summaries into turns (prompt → tools → stop).
func buildTimeline(summaries []eventSummary) timelineResponse {
	resp := timelineResponse{
		Session: sessionSummary{ID: "unknown", Name: "Unknown session"},
		Turns:   []turn{},
	}
	if len(summaries) == 0 {
		return resp
	}
	// Pick session identity from the first summary.
	first := summaries[0]
	resp.Session.ID = first.SessionID
	resp.Session.Name = first.SessionName
	resp.Session.StartedAt = first.EventTime
	resp.Session.EventCount = len(summaries)

	// Walk every summary and compute the chronologically latest end via
	// time.Time, not string compare. RFC3339Nano strips trailing zeros
	// ("...00.5Z" vs "...00.50Z") so lex order is unreliable.
	var startTime, endTime time.Time
	startTime, _ = time.Parse(time.RFC3339Nano, first.EventTime)
	for _, s := range summaries {
		sEv, _ := time.Parse(time.RFC3339Nano, s.EventTime)
		eEv, _ := time.Parse(time.RFC3339Nano, s.endTimeOrTime())
		if sEv.Before(startTime) {
			startTime = sEv
		}
		if eEv.After(endTime) {
			endTime = eEv
		}
	}
	resp.Session.StartedAt = startTime.UTC().Format(time.RFC3339Nano)
	resp.Session.EndedAt = endTime.UTC().Format(time.RFC3339Nano)
	if !endTime.IsZero() {
		d := endTime.Sub(startTime).Milliseconds()
		if d < 0 {
			d = 0
		}
		resp.Session.DurationMS = d
	}

	var current *turn
	flush := func() {
		if current == nil {
			return
		}
		resp.Turns = append(resp.Turns, *current)
		current = nil
	}
	advanceEndedAt := func(t *turn, candidate string) {
		// Compare as time.Time so fractional width differences don't fool us.
		cEv, err := time.Parse(time.RFC3339Nano, candidate)
		if err != nil {
			return
		}
		if t.EndedAt == "" {
			t.EndedAt = candidate
			return
		}
		eEv, err := time.Parse(time.RFC3339Nano, t.EndedAt)
		if err != nil {
			t.EndedAt = candidate
			return
		}
		if cEv.After(eEv) {
			t.EndedAt = candidate
		}
	}
	for _, s := range summaries {
		switch s.Kind {
		case kindUserPrompt:
			flush()
			promptCopy := s
			current = &turn{
				StartedAt: s.EventTime,
				Prompt:    &promptCopy,
				Tools:     []eventSummary{},
				Notes:     []eventSummary{},
			}
		case kindTool:
			if current == nil {
				// Tool without a preceding prompt: start a synthetic turn.
				current = &turn{StartedAt: s.EventTime, Tools: []eventSummary{}, Notes: []eventSummary{}}
			}
			current.Tools = append(current.Tools, s)
			if s.Status == statusError {
				resp.Session.FailureCount++
			}
			resp.Session.ToolCount++
			advanceEndedAt(current, s.endTimeOrTime())
		case kindAssistantStop:
			if current != nil {
				respCopy := s
				current.Response = &respCopy
				advanceEndedAt(current, s.EventTime)
				flush()
			} else {
				// Standalone Stop (no preceding prompt): still surface it.
				stopCopy := s
				flush()
				current = &turn{
					StartedAt: s.EventTime,
					EndedAt:   s.EventTime,
					Response:  &stopCopy,
					Tools:     []eventSummary{},
					Notes:     []eventSummary{},
				}
				flush()
			}
		default:
			// Notifications, PermissionRequests, SessionStart/End, PreCompact,
			// and any other non-tool event are attached to the current turn as
			// "notes" so they remain visible instead of silently dropping.
			if current == nil {
				current = &turn{StartedAt: s.EventTime, Tools: []eventSummary{}, Notes: []eventSummary{}}
			}
			if s.Status == statusError {
				resp.Session.FailureCount++
			}
			current.Notes = append(current.Notes, s)
			advanceEndedAt(current, s.EventTime)
		}
	}
	flush()
	// Every rendered turn counts, including synthetic tool-only turns.
	resp.Session.TurnCount = len(resp.Turns)
	return resp
}

func countTurns(turns []turn) int {
	return len(turns)
}

// --- Session label / id helpers (preserved from original) ---

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

// --- Generic helpers ---

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

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// --- Payload accessors ---

func stringFromPayload(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if s, ok := payload[key].(string); ok {
		return s
	}
	return ""
}

func mapFromPayload(payload map[string]any, key string) map[string]any {
	if payload == nil {
		return nil
	}
	if m, ok := payload[key].(map[string]any); ok {
		return m
	}
	return nil
}

func stringFromMap(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if s, ok := m[key].(string); ok {
		return s
	}
	return ""
}

func numberFromMap(m map[string]any, key string) int64 {
	if m == nil {
		return 0
	}
	if v, ok := m[key]; ok {
		if n, ok := toInt64(v); ok {
			return n
		}
	}
	return 0
}

func toInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case uint:
		return int64(n), true
	case uint32:
		return int64(n), true
	case uint64:
		return int64(n), true
	case float32:
		return int64(n), true
	case float64:
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		if err == nil {
			return i, true
		}
		f, err := n.Float64()
		if err == nil {
			return int64(f), true
		}
	}
	return 0, false
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstLine(s string) string {
	if i := strings.IndexAny(s, "\n\r"); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// relativizePath turns an absolute path into a path relative to the given
// working directory when possible. Returns the original path when cwd is
// empty or the path cannot be expressed relative to it.
func relativizePath(path, cwd string) string {
	if path == "" {
		return ""
	}
	if cwd == "" {
		return path
	}
	rel, err := filepath.Rel(cwd, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return path
	}
	return rel
}

func postToolName(post *hookEvent) string {
	if post == nil {
		return ""
	}
	return stringFromPayload(post.Payload, "tool_name")
}

func eventTime(a, b *hookEvent) time.Time {
	if a != nil {
		return a.EventTime
	}
	if b != nil {
		return b.EventTime
	}
	return time.Time{}
}

func pickEventID(pre, post *hookEvent) string {
	if pre != nil && pre.EventID != "" {
		return pre.EventID
	}
	if post != nil && post.EventID != "" {
		return post.EventID
	}
	return ""
}

func pickSessionID(pre, post *hookEvent) string {
	if pre != nil {
		return pre.SessionID
	}
	if post != nil {
		return post.SessionID
	}
	return ""
}

func pickSessionName(pre, post *hookEvent) string {
	if pre != nil && pre.SessionName != "" {
		return pre.SessionName
	}
	if post != nil {
		return post.SessionName
	}
	return ""
}

func postPayload(post *hookEvent) map[string]any {
	if post == nil {
		return nil
	}
	return post.Payload
}

// patchStats returns the add/remove line counts from a structuredPatch.
func patchStats(response map[string]any) (add, rem int, ok bool) {
	patch, ok := response["structuredPatch"].([]any)
	if !ok {
		return 0, 0, false
	}
	for _, hunk := range patch {
		h, ok := hunk.(map[string]any)
		if !ok {
			continue
		}
		lines, ok := h["lines"].([]any)
		if !ok {
			continue
		}
		for _, line := range lines {
			s, ok := line.(string)
			if !ok {
				continue
			}
			if strings.HasPrefix(s, "+") {
				add++
			} else if strings.HasPrefix(s, "-") {
				rem++
			}
		}
	}
	return add, rem, true
}

// fallbackEventID generates a stable identifier for rows that don't yet
// have a UUID (e.g. rows inserted before the event_id column existed).
// computeNaturalID returns the deterministic natural identifier for a row.
// It hashes (session_id, event_name, tool_use_id, event_time) so that
// repeated same-name events within a session (e.g. multiple UserPromptSubmit
// or Stop rows) get distinct IDs — the public ID is one-per-row, not
// one-per-natural-key. event_time is DateTime64(3) DEFAULT now64(3),
// materialized at insert and stable across re-reads/merges, so the
// natural_id is also stable. The same formula is mirrored in the
// backfill mutation (main.go:backfillNaturalIDs) — keep the two in sync.
func computeNaturalID(sessionID, eventName, toolUseID string, eventTime time.Time) string {
	parts := []string{
		sessionID,
		eventName,
		toolUseID,
		strconv.FormatInt(eventTime.UnixMilli(), 10),
	}
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return "legacy-" + hex.EncodeToString(h[:12])
}

// The resulting ID is deterministic for the same natural key + time, so
// the UI can round-trip through it.
func fallbackEventID(e *hookEvent) string {
	return computeNaturalID(e.SessionID, e.EventName, e.ToolUseID, e.EventTime)
}

// classifyEvent maps the raw event_name to a normalized kind.
func classifyEvent(name string) string {
	switch name {
	case "UserPromptSubmit":
		return kindUserPrompt
	case "Stop", "SubagentStop", "AssistantStop":
		return kindAssistantStop
	case "PreToolUse", "PostToolUse":
		return kindTool
	case "SessionStart":
		return kindSessionStart
	case "SessionEnd":
		return kindSessionEnd
	case "Notification":
		return kindNotification
	case "PermissionRequest", "PermissionPrompt":
		return kindPermissionReq
	case "PreCompact", "PostCompact":
		return kindCompact
	}
	return kindOther
}

// endTimeOrTime returns EndTime if set, else EventTime.
func (s eventSummary) endTimeOrTime() string {
	if s.EndTime != "" {
		return s.EndTime
	}
	return s.EventTime
}
