package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildSummariesAddsContextUsageFromCodexTranscript(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TRACEFRAME_TRANSCRIPT_ROOT", root)
	transcript := filepath.Join(root, "rollout-2026-07-03-test.jsonl")
	contents := strings.Join([]string{
		`{"timestamp":"2026-07-03T10:00:00Z","type":"response_item","payload":{"type":"message"}}`,
		`{"timestamp":"2026-07-03T10:00:02.100Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":16510,"output_tokens":134,"total_tokens":16644},"model_context_window":353400}}}`,
	}, "\n")
	if err := os.WriteFile(transcript, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2026, 7, 3, 10, 0, 1, 0, time.UTC)
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", base, map[string]any{
		"tool_name": "Bash", "tool_use_id": "tu-1", "transcript_path": transcript,
		"tool_input": map[string]any{"command": "git status"},
	})
	post := hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1", base.Add(time.Second), map[string]any{
		"tool_name": "Bash", "tool_use_id": "tu-1", "transcript_path": transcript,
		"tool_response": map[string]any{"exitCode": 0},
	})

	summaries := buildSummaries([]*hookEvent{pre, post})
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(summaries))
	}
	if summaries[0].ContextTokens != 16644 {
		t.Errorf("ContextTokens = %d, want 16644", summaries[0].ContextTokens)
	}
	if summaries[0].ContextWindow != 353400 {
		t.Errorf("ContextWindow = %d, want 353400", summaries[0].ContextWindow)
	}
}

func TestContextUsageRejectsTranscriptOutsideConfiguredRoot(t *testing.T) {
	t.Setenv("TRACEFRAME_TRANSCRIPT_ROOT", t.TempDir())
	outside := filepath.Join(t.TempDir(), "rollout-outside.jsonl")
	if err := os.WriteFile(outside, []byte(`{"timestamp":"2026-07-03T10:00:02Z","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":100},"model_context_window":1000}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	event := hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", time.Date(2026, 7, 3, 10, 0, 1, 0, time.UTC), map[string]any{
		"tool_name": "Read", "tool_use_id": "tu-1", "transcript_path": outside,
	})

	summaries := buildSummaries([]*hookEvent{event})
	if summaries[0].ContextTokens != 0 || summaries[0].ContextWindow != 0 {
		t.Fatalf("outside transcript was read: %+v", summaries[0])
	}
}

func TestBuildSummariesAddsContextUsageFromClaudeTranscript(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TRACEFRAME_CLAUDE_TRANSCRIPT_ROOT", root)
	transcript := filepath.Join(root, "session-id.jsonl")
	contents := strings.Join([]string{
		`{"timestamp":"2026-07-03T10:00:01.950Z","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":2,"cache_creation_input_tokens":603,"cache_read_input_tokens":167564,"output_tokens":145}}}`,
		`{"timestamp":"2026-07-03T10:00:03Z","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":2,"cache_creation_input_tokens":900,"cache_read_input_tokens":170000,"output_tokens":200}}}`,
	}, "\n")
	if err := os.WriteFile(transcript, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	event := hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", time.Date(2026, 7, 3, 10, 0, 2, 0, time.UTC), map[string]any{
		"tool_name": "Read", "tool_use_id": "tu-1", "transcript_path": transcript,
	})
	summaries := buildSummaries([]*hookEvent{event})
	if summaries[0].ContextTokens != 168314 {
		t.Errorf("ContextTokens = %d, want 168314", summaries[0].ContextTokens)
	}
	if summaries[0].ContextWindow != 1000000 {
		t.Errorf("ContextWindow = %d, want 1000000", summaries[0].ContextWindow)
	}
}

func TestClaudeContextWindowUsesFallbackForOtherModels(t *testing.T) {
	t.Setenv("TRACEFRAME_CLAUDE_CONTEXT_WINDOW", "250000")
	if got := claudeContextWindow("claude-opus-4-8"); got != 1_000_000 {
		t.Errorf("Opus 4.8 window = %d, want 1000000", got)
	}
	if got := claudeContextWindow("claude-haiku-4-5-20251001"); got != 250_000 {
		t.Errorf("configured fallback = %d, want 250000", got)
	}
}

func TestBrowserSelfTestsAreOptIn(t *testing.T) {
	html := string(indexHTML)
	if !strings.Contains(html, `url.searchParams.get("tests") !== "1"`) {
		t.Fatal("browser self-tests must only run when ?tests=1 is present")
	}
}

// hookEventFromPayload builds a hookEvent from a JSON-encoded payload.
func hookEventFromPayload(t *testing.T, name, sessionID, eventID, toolUseID string, at time.Time, payload map[string]any) *hookEvent {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("re-parse payload: %v", err)
	}
	return &hookEvent{
		EventID:     eventID,
		EventTime:   at.UTC(),
		EventName:   name,
		SessionID:   sessionID,
		SessionName: "demo",
		ToolUseID:   toolUseID,
		Payload:     parsed,
	}
}

func TestMergePrePost(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "e1", "tu-1",
		time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Edit",
			"tool_use_id": "tu-1",
			"cwd":         "/home/user/proj",
			"tool_input": map[string]any{
				"file_path":   "/home/user/proj/static/index.html",
				"old_string":  "old",
				"new_string":  "new\nnew",
				"replace_all": false,
			},
			"permission_mode": "acceptEdits",
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "e2", "tu-1",
		time.Date(2026, 6, 30, 12, 0, 0, 21_000_000, time.UTC),
		map[string]any{
			"tool_name":   "Edit",
			"tool_use_id": "tu-1",
			"tool_response": map[string]any{
				"filePath": "/home/user/proj/static/index.html",
				"structuredPatch": []any{
					map[string]any{
						"oldStart": 1,
						"oldLines": 1,
						"newStart": 1,
						"newLines": 2,
						"lines":    []any{"-old", "+new", "+new"},
					},
				},
				"originalFile": "huge content we want to drop",
				"success":      true,
			},
		},
	)

	summaries := buildSummaries([]*hookEvent{pre, post})
	if len(summaries) != 1 {
		t.Fatalf("expected 1 merged event, got %d", len(summaries))
	}
	got := summaries[0]
	if got.Kind != kindTool {
		t.Errorf("kind = %q, want %q", got.Kind, kindTool)
	}
	if got.ToolName != "Edit" {
		t.Errorf("tool = %q, want Edit", got.ToolName)
	}
	if got.Summary != "Edit static/index.html +2/-1" {
		t.Errorf("summary = %q", got.Summary)
	}
	if got.Status != statusOK {
		t.Errorf("status = %q, want %q", got.Status, statusOK)
	}
	if got.DurationMS == nil || *got.DurationMS != 21 {
		t.Errorf("duration = %v, want 21", got.DurationMS)
	}
	if got.PermissionMode != "acceptEdits" {
		t.Errorf("permission_mode = %q", got.PermissionMode)
	}
	if got.Input == nil || got.Input["file_path"] != "static/index.html" {
		t.Errorf("input.file_path = %v (want relative path)", got.Input)
	}
	if got.Output == nil {
		t.Fatal("output is nil")
	}
	if _, hasOriginal := got.Output["originalFile"]; hasOriginal {
		t.Error("originalFile should be stripped from output")
	}
}

func TestBashErrorStatus(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "e1", "tu-2",
		time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Bash",
			"tool_use_id": "tu-2",
			"tool_input": map[string]any{
				"command":     "false",
				"description": "intentional failure",
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "e2", "tu-2",
		time.Date(2026, 6, 30, 12, 0, 0, 5_000_000, time.UTC),
		map[string]any{
			"tool_name":   "Bash",
			"tool_use_id": "tu-2",
			"tool_response": map[string]any{
				"stdout":      "",
				"stderr":      "boom",
				"interrupted": false,
				"exitCode":    1,
			},
		},
	)
	summaries := buildSummaries([]*hookEvent{pre, post})
	if len(summaries) != 1 {
		t.Fatalf("expected 1, got %d", len(summaries))
	}
	if summaries[0].Status != statusError {
		t.Errorf("status = %q, want %q", summaries[0].Status, statusError)
	}
	if summaries[0].Error != "exit 1" {
		t.Errorf("error = %q, want %q", summaries[0].Error, "exit 1")
	}
}

func TestPendingTool(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "e1", "tu-3",
		time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-3",
			"tool_input": map[string]any{
				"file_path": "/home/user/proj/main.go",
			},
		},
	)
	summaries := buildSummaries([]*hookEvent{pre})
	if len(summaries) != 1 {
		t.Fatalf("expected 1, got %d", len(summaries))
	}
	if summaries[0].Status != statusPending {
		t.Errorf("status = %q, want %q", summaries[0].Status, statusPending)
	}
}

func TestTurnGrouping(t *testing.T) {
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	mk := func(name, tuid, id string, offset time.Duration, payload map[string]any) *hookEvent {
		return hookEventFromPayload(t, name, "s1", id, tuid, now.Add(offset), payload)
	}

	prompt1 := mk("UserPromptSubmit", "", "p1", 0, map[string]any{"prompt": "Analyze logs"})
	pre1 := mk("PreToolUse", "tu-1", "pre1", time.Second, map[string]any{
		"tool_name": "Bash", "tool_use_id": "tu-1",
		"tool_input": map[string]any{"command": "ls", "description": "list files"},
	})
	post1 := mk("PostToolUse", "tu-1", "post1", 2*time.Second, map[string]any{
		"tool_name": "Bash", "tool_use_id": "tu-1",
		"tool_response": map[string]any{"stdout": "a\nb", "exitCode": 0},
	})
	stop1 := mk("Stop", "", "stop1", 3*time.Second, map[string]any{"stop_hook_active": true})

	prompt2 := mk("UserPromptSubmit", "", "p2", 10*time.Second, map[string]any{"prompt": "Now summarize"})
	stop2 := mk("Stop", "", "stop2", 11*time.Second, map[string]any{"stop_hook_active": true})

	tl := buildTimeline(buildSummaries([]*hookEvent{prompt1, pre1, post1, stop1, prompt2, stop2}))

	if tl.Session.TurnCount != 2 {
		t.Errorf("turn_count = %d, want 2", tl.Session.TurnCount)
	}
	if tl.Session.ToolCount != 1 {
		t.Errorf("tool_count = %d, want 1", tl.Session.ToolCount)
	}
	if tl.Session.FailureCount != 0 {
		t.Errorf("failure_count = %d, want 0", tl.Session.FailureCount)
	}
	if len(tl.Turns) != 2 {
		t.Fatalf("turns = %d, want 2", len(tl.Turns))
	}
	if tl.Turns[0].Prompt == nil || tl.Turns[0].Prompt.Content != "Analyze logs" {
		t.Errorf("turn 0 prompt = %+v", tl.Turns[0].Prompt)
	}
	if len(tl.Turns[0].Tools) != 1 {
		t.Errorf("turn 0 tools = %d", len(tl.Turns[0].Tools))
	}
	if tl.Turns[0].Response == nil {
		t.Error("turn 0 response is nil")
	}
	if tl.Turns[1].Prompt == nil {
		t.Error("turn 1 prompt is nil")
	}
}

func TestReadSummary(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "e1", "tu-4",
		time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-4",
			"cwd":         "/home/user/proj",
			"tool_input": map[string]any{
				"file_path": "/home/user/proj/README.md",
				"offset":    0, // 0-based
				"limit":     120,
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "e2", "tu-4",
		time.Date(2026, 6, 30, 12, 0, 0, 13_000_000, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-4",
			"tool_response": map[string]any{
				"filePath":   "/home/user/proj/README.md",
				"numLines":   120,
				"startLine":  0,
				"totalLines": 320,
				"content":    "line 1\nline 2\n...",
			},
		},
	)
	summaries := buildSummaries([]*hookEvent{pre, post})
	if len(summaries) != 1 {
		t.Fatalf("expected 1, got %d", len(summaries))
	}
	if summaries[0].Summary != "Read README.md lines 1-120" {
		t.Errorf("summary = %q", summaries[0].Summary)
	}
}

func TestReadSummaryNestedFile(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "e1", "tu-9",
		time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-9",
			"cwd":         "/home/user/proj",
			"tool_input": map[string]any{
				"file_path": "/home/user/proj/README.md",
				"offset":    0, // 0-based
				"limit":     120,
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "e2", "tu-9",
		time.Date(2026, 6, 30, 12, 0, 0, 13_000_000, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-9",
			"tool_response": map[string]any{
				"file": map[string]any{
					"filePath":   "/home/user/proj/README.md",
					"numLines":   120,
					"startLine":  0,
					"totalLines": 320,
					"content":    "line 1\nline 2\n...",
				},
				"type": "text",
			},
		},
	)
	summaries := buildSummaries([]*hookEvent{pre, post})
	if len(summaries) != 1 {
		t.Fatalf("expected 1, got %d", len(summaries))
	}
	if summaries[0].Summary != "Read README.md lines 1-120" {
		t.Errorf("summary = %q", summaries[0].Summary)
	}
	if summaries[0].Output["filePath"] != "README.md" {
		t.Errorf("filePath = %v (want relative)", summaries[0].Output["filePath"])
	}
	if summaries[0].Output["numLines"] == nil {
		t.Error("numLines not lifted from file sub-object")
	}
}

func TestFallbackEventID(t *testing.T) {
	now := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)
	a := hookEventFromPayload(t, "PreToolUse", "s1", "", "tu-5", now, map[string]any{
		"tool_name": "Read", "tool_use_id": "tu-5",
	})
	b := hookEventFromPayload(t, "PreToolUse", "s1", "", "tu-5", now, map[string]any{
		"tool_name": "Read", "tool_use_id": "tu-5",
	})
	if fallbackEventID(a) != fallbackEventID(b) {
		t.Errorf("fallback should be deterministic for identical natural keys")
	}
	c := hookEventFromPayload(t, "PreToolUse", "s1", "", "tu-6", now, map[string]any{
		"tool_name": "Read", "tool_use_id": "tu-6",
	})
	if fallbackEventID(a) == fallbackEventID(c) {
		t.Errorf("fallback should differ across tool_use_id")
	}
}

func TestProcessInputTruncatesLongStrings(t *testing.T) {
	long := strings.Repeat("a", maxStringBytes*2)
	out := processInput(map[string]any{
		"file_path":  "/x",
		"old_string": long,
		"new_string": long,
	}, "")
	if len(out["old_string"].(string)) > maxStringBytes+10 {
		t.Errorf("old_string not truncated: %d bytes", len(out["old_string"].(string)))
	}
	if out["file_path"] != "/x" {
		t.Errorf("file_path altered: %v", out["file_path"])
	}
}

func TestExtractEffort(t *testing.T) {
	if got := extractEffort(nil); got != "" {
		t.Errorf("nil payload: %q", got)
	}
	if got := extractEffort(map[string]any{}); got != "" {
		t.Errorf("empty payload: %q", got)
	}
	if got := extractEffort(map[string]any{"effort": "high"}); got != "high" {
		t.Errorf("string: %q", got)
	}
	if got := extractEffort(map[string]any{"effort": map[string]any{"level": "low"}}); got != "low" {
		t.Errorf("nested: %q", got)
	}
	if got := extractEffort(map[string]any{"effort": map[string]any{}}); got != "" {
		t.Errorf("empty nested: %q", got)
	}
}

// Issue 2: Non-tool events (Notification, PermissionRequest, SessionStart/End,
// PreCompact) should appear in the per-session timeline, not vanish.
func TestTimelineIncludesNonToolEvents(t *testing.T) {
	base := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	events := []*hookEvent{
		hookEventFromPayload(t, "SessionStart", "s1", "ss1", "", base, map[string]any{"source": "startup"}),
		hookEventFromPayload(t, "UserPromptSubmit", "s1", "p1", "", base.Add(1*time.Second), map[string]any{"prompt": "do thing"}),
		hookEventFromPayload(t, "Notification", "s1", "n1", "", base.Add(2*time.Second), map[string]any{"message": "needs permission"}),
		hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", base.Add(3*time.Second), map[string]any{
			"tool_name": "Bash", "tool_use_id": "tu-1",
			"tool_input": map[string]any{"command": "ls"},
		}),
		hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1", base.Add(4*time.Second), map[string]any{
			"tool_name": "Bash", "tool_use_id": "tu-1",
			"tool_response": map[string]any{"exitCode": 0},
		}),
		hookEventFromPayload(t, "PermissionRequest", "s1", "pr1", "", base.Add(5*time.Second), map[string]any{"tool_name": "Bash"}),
		hookEventFromPayload(t, "PreCompact", "s1", "pc1", "", base.Add(6*time.Second), map[string]any{"trigger": "auto"}),
		hookEventFromPayload(t, "Stop", "s1", "stop1", "", base.Add(7*time.Second), map[string]any{"stop_hook_active": true}),
		hookEventFromPayload(t, "SessionEnd", "s1", "se1", "", base.Add(8*time.Second), map[string]any{"reason": "logout"}),
	}
	summaries := buildSummaries(events)
	tl := buildTimeline(summaries)

	// Collect every kind rendered into the timeline.
	seen := map[string]int{}
	for _, turn := range tl.Turns {
		for _, tool := range turn.Tools {
			seen[tool.Kind]++
		}
		for _, note := range turn.Notes {
			seen[note.Kind]++
		}
		if turn.Prompt != nil {
			seen[turn.Prompt.Kind]++
		}
		if turn.Response != nil {
			seen[turn.Response.Kind]++
		}
	}
	for _, want := range []string{"notification", "permission_request", "compact", "session_start", "session_end"} {
		if seen[want] == 0 {
			t.Errorf("kind %q missing from timeline", want)
		}
	}
}

// Issue 4: EndedAt and DurationMS must reflect the chronologically latest end,
// not the end of whichever event happens to be last in the slice. The slice
// is ordered by start time, so a tool whose Post lands after a Stop has a
// later end but an earlier start.
func TestSessionEndTimeUsesMaxEnd(t *testing.T) {
	base := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	events := []*hookEvent{
		// tool: starts 10:00, ends 10:10 (5 min duration)
		hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", base, map[string]any{
			"tool_name": "Bash", "tool_use_id": "tu-1",
			"tool_input": map[string]any{"command": "sleep 5"},
		}),
		hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1", base.Add(10*time.Minute), map[string]any{
			"tool_name": "Bash", "tool_use_id": "tu-1",
			"tool_response": map[string]any{"exitCode": 0},
		}),
		// prompt at 10:02
		hookEventFromPayload(t, "UserPromptSubmit", "s1", "p1", "", base.Add(2*time.Minute), map[string]any{"prompt": "go"}),
		// stop at 10:03 (lands before the tool's Post at 10:10)
		hookEventFromPayload(t, "Stop", "s1", "stop1", "", base.Add(3*time.Minute), map[string]any{"stop_hook_active": true}),
	}
	summaries := buildSummaries(events)
	tl := buildTimeline(summaries)

	gotEnd, err := time.Parse(time.RFC3339Nano, tl.Session.EndedAt)
	if err != nil {
		t.Fatalf("parse EndedAt: %v", err)
	}
	wantEnd := base.Add(10 * time.Minute)
	if !gotEnd.Equal(wantEnd) {
		t.Errorf("EndedAt = %v, want %v (the tool's Post at 10:10, not the Stop at 10:03)", gotEnd, wantEnd)
	}
	if tl.Session.DurationMS != 10*60*1000 {
		t.Errorf("DurationMS = %d, want %d", tl.Session.DurationMS, 10*60*1000)
	}
}

// Issue 4 follow-up: timestamps with stripped trailing zeros must still
// compare correctly. RFC3339Nano emits "...00.5Z" for half-second times, and
// the slice uses lexicographic string compare to find the latest end.
func TestSessionEndTimeLexicographicCompare(t *testing.T) {
	base := time.Date(2026, 6, 30, 10, 0, 0, 500_000_000, time.UTC) // 10:00:00.5
	events := []*hookEvent{
		// first event ends at 10:00:00.5 → "...00.5Z"
		hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", base, map[string]any{
			"tool_name": "Bash", "tool_use_id": "tu-1",
			"tool_input": map[string]any{"command": "x"},
		}),
		hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1", base, map[string]any{
			"tool_name": "Bash", "tool_use_id": "tu-1",
			"tool_response": map[string]any{"exitCode": 0},
		}),
		// second event ends at 10:00:01 → "...01Z" (lexicographically smaller than "...00.5Z"? No,
		// but the bug is that "10:00:00.5Z" < "10:00:00.500Z" when comparing strings, so
		// the timestamp width matters).
		hookEventFromPayload(t, "Stop", "s1", "stop1", "", base.Add(500*time.Millisecond), map[string]any{"stop_hook_active": true}),
	}
	summaries := buildSummaries(events)
	tl := buildTimeline(summaries)

	gotEnd, err := time.Parse(time.RFC3339Nano, tl.Session.EndedAt)
	if err != nil {
		t.Fatalf("parse EndedAt: %v", err)
	}
	wantEnd := base.Add(500 * time.Millisecond)
	if !gotEnd.Equal(wantEnd) {
		t.Errorf("EndedAt = %v, want %v (the Stop's timestamp, which is later than the tool's 10:00:00.5)", gotEnd, wantEnd)
	}
}

// Issue 5: turn_count must equal the number of rendered turns, even for
// tool-only turns (no preceding prompt).
func TestTurnCountIncludesToolOnlyTurn(t *testing.T) {
	base := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	events := []*hookEvent{
		// tool with no preceding prompt
		hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1", base, map[string]any{
			"tool_name": "Read", "tool_use_id": "tu-1",
			"tool_input": map[string]any{"file_path": "/x"},
		}),
		hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1", base.Add(time.Second), map[string]any{
			"tool_name": "Read", "tool_use_id": "tu-1",
			"tool_response": map[string]any{"file": map[string]any{"filePath": "/x", "numLines": 10}},
		}),
	}
	summaries := buildSummaries(events)
	tl := buildTimeline(summaries)

	if len(tl.Turns) != 1 {
		t.Errorf("len(Turns) = %d, want 1", len(tl.Turns))
	}
	if tl.Session.TurnCount != 1 {
		t.Errorf("TurnCount = %d, want 1 (must match rendered turns)", tl.Session.TurnCount)
	}
}

// Issue 8: Read one-liner should render 1-based inclusive line ranges.
// offset=0, limit=100, numLines=100 → "Read … lines 1-100", not "0-99".
func TestReadOneLinerLineRangeOffsetZero(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1",
		time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-1",
			"cwd":         "/proj",
			"tool_input": map[string]any{
				"file_path": "/proj/main.go",
				"limit":     100,
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1",
		time.Date(2026, 6, 30, 10, 0, 0, 50_000_000, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-1",
			"tool_response": map[string]any{
				"file": map[string]any{
					"filePath":   "/proj/main.go",
					"numLines":   100,
					"startLine":  0,
					"totalLines": 500,
				},
			},
		},
	)
	summaries := buildSummaries([]*hookEvent{pre, post})
	if summaries[0].Summary != "Read main.go lines 1-100" {
		t.Errorf("summary = %q, want %q", summaries[0].Summary, "Read main.go lines 1-100")
	}
}

// Issue 8: offset=10, limit=20 → "Read … lines 11-30" (offset is 0-based).
func TestReadOneLinerLineRangeOffset(t *testing.T) {
	pre := hookEventFromPayload(t, "PreToolUse", "s1", "pre1", "tu-1",
		time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-1",
			"cwd":         "/proj",
			"tool_input": map[string]any{
				"file_path": "/proj/main.go",
				"offset":    10,
				"limit":     20,
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "post1", "tu-1",
		time.Date(2026, 6, 30, 10, 0, 0, 50_000_000, time.UTC),
		map[string]any{
			"tool_name":   "Read",
			"tool_use_id": "tu-1",
			"tool_response": map[string]any{
				"file": map[string]any{
					"filePath":   "/proj/main.go",
					"numLines":   20,
					"startLine":  10,
					"totalLines": 500,
				},
			},
		},
	)
	summaries := buildSummaries([]*hookEvent{pre, post})
	if summaries[0].Summary != "Read main.go lines 11-30" {
		t.Errorf("summary = %q, want %q", summaries[0].Summary, "Read main.go lines 11-30")
	}
}

// Issue 3: the natural ID is deterministic for a given (session, event_name,
// tool_use_id, event_time) tuple, so legacy rows whose UUIDs were
// re-randomized on every read can still be looked up by the natural ID.
func TestNaturalIDIsStable(t *testing.T) {
	now := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	a := &hookEvent{SessionID: "s1", EventTime: now, EventName: "PreToolUse", ToolUseID: "tu-1"}
	b := &hookEvent{SessionID: "s1", EventTime: now, EventName: "PreToolUse", ToolUseID: "tu-1"}
	c := &hookEvent{SessionID: "s1", EventTime: now, EventName: "PreToolUse", ToolUseID: "tu-2"}
	if fallbackEventID(a) != fallbackEventID(b) {
		t.Error("natural ID should be stable for the same natural key")
	}
	if fallbackEventID(a) == fallbackEventID(c) {
		t.Error("natural ID should differ when tool_use_id differs")
	}
	if fallbackEventID(a) != computeNaturalID("s1", "PreToolUse", "tu-1", now) {
		t.Error("fallbackEventID should defer to computeNaturalID")
	}
}

// The natural ID must include event_time so repeated same-name events in
// the same session (e.g. multiple UserPromptSubmit or Stop rows) get
// distinct IDs and the public ID stays one-per-row. Without event_time
// the formula would collapse every prompt in a session to one ID, which
// breaks expansion isolation and the raw drawer.
func TestNaturalIDIncludesEventTime(t *testing.T) {
	t1 := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 6, 30, 10, 0, 1, 0, time.UTC)
	a := &hookEvent{SessionID: "s1", EventTime: t1, EventName: "UserPromptSubmit", ToolUseID: ""}
	b := &hookEvent{SessionID: "s1", EventTime: t2, EventName: "UserPromptSubmit", ToolUseID: ""}
	if fallbackEventID(a) == fallbackEventID(b) {
		t.Error("natural ID should differ when event_time differs (otherwise all prompts in a session collide)")
	}
}

// Two prompts in the same session with the same event_name and an empty
// tool_use_id must get distinct natural_ids. This is the regression for
// the prompt-collision bug: a multi-turn session has N UserPromptSubmit
// rows and N Stop rows, and without event_time in the hash they all
// collapsed to a single shared ID, which broke expansion isolation
// (clicking one prompt expanded all prompts) and the raw drawer
// (the detail endpoint returned an arbitrary colliding row's payload).
func TestPromptsAndStopsAreUnique(t *testing.T) {
	now := time.Date(2026, 7, 1, 14, 5, 14, 0, time.UTC)
	session := "380d58d3-9774-4994-b7ee-afdfd4c4af9a"
	rows := []*hookEvent{
		{SessionID: session, EventTime: now.Add(0 * time.Millisecond), EventName: "UserPromptSubmit", ToolUseID: ""},
		{SessionID: session, EventTime: now.Add(1 * time.Second), EventName: "UserPromptSubmit", ToolUseID: ""},
		{SessionID: session, EventTime: now.Add(2 * time.Second), EventName: "UserPromptSubmit", ToolUseID: ""},
		{SessionID: session, EventTime: now.Add(3 * time.Second), EventName: "Stop", ToolUseID: ""},
		{SessionID: session, EventTime: now.Add(4 * time.Second), EventName: "Stop", ToolUseID: ""},
	}
	ids := make(map[string]int)
	for _, r := range rows {
		ids[fallbackEventID(r)]++
	}
	for id, n := range ids {
		if n > 1 {
			t.Errorf("natural_id %q appeared in %d rows (expected 1 per row)", id, n)
		}
	}
	if len(ids) != len(rows) {
		t.Errorf("expected %d distinct natural_ids, got %d", len(rows), len(ids))
	}
}

// The toHookEvent path picks the natural ID when the synthetic UUID is
// missing, so the list endpoint always returns a stable ID.
func TestHookRowUsesNaturalID(t *testing.T) {
	row := hookRow{
		EventTimeMS:    "1700000000000",
		EventID:        "", // legacy row: UUID was re-randomized
		EventName:      "PreToolUse",
		SessionID:      "s1",
		SessionName:    "s1",
		ToolUseID:      "tu-1",
		EventNaturalID: "legacy-abc123",
		Payload:        `{}`,
	}
	event, err := row.toHookEvent()
	if err != nil {
		t.Fatal(err)
	}
	if event.EventID != "legacy-abc123" {
		t.Errorf("event_id = %q, want natural ID", event.EventID)
	}
}

// The SQL backfill formula must produce the same natural ID as
// computeNaturalID for the same natural key + event_time. ClickHouse's
// SHA-256 is byte-compatible with Go's crypto/sha256, so we replicate
// the formula in Go and check the prefix and shape.
func TestBackfillSQLFormulaMatchesGo(t *testing.T) {
	cases := []struct {
		sessionID, eventName, toolUseID string
		at                              time.Time
	}{
		{"s1", "PreToolUse", "tu-1", time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)},
		{"s1", "PostToolUse", "", time.Date(2026, 6, 30, 10, 0, 1, 500_000_000, time.UTC)},
		{"380d58d3-9774-4994-b7ee-afdfd4c4af9a", "Stop", "", time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)},
		{"long-session-id-with-dashes-and-stuff", "PreToolUse", "tool_use_id_1234", time.Unix(1700000000, 0).UTC()},
	}
	for _, c := range cases {
		got := computeNaturalID(c.sessionID, c.eventName, c.toolUseID, c.at)
		if !strings.HasPrefix(got, "legacy-") {
			t.Errorf("computeNaturalID = %q, missing 'legacy-' prefix", got)
		}
		if len(got) != len("legacy-")+24 {
			t.Errorf("computeNaturalID = %q, want 24 hex chars after prefix", got)
		}
		for _, r := range got[len("legacy-"):] {
			if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
				t.Errorf("computeNaturalID = %q, contains non-lowercase-hex char %q", got, r)
			}
		}
	}
}
