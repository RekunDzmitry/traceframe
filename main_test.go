package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

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
			"tool_name":  "Edit",
			"tool_use_id": "tu-1",
			"cwd":        "/home/user/proj",
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
			"tool_name":  "Edit",
			"tool_use_id": "tu-1",
			"tool_response": map[string]any{
				"filePath": "/home/user/proj/static/index.html",
				"structuredPatch": []any{
					map[string]any{
						"oldStart":  1,
						"oldLines":  1,
						"newStart":  1,
						"newLines":  2,
						"lines":     []any{"-old", "+new", "+new"},
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
			"tool_name":  "Bash",
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
			"tool_name":  "Bash",
			"tool_use_id": "tu-2",
			"tool_response": map[string]any{
				"stdout":     "",
				"stderr":     "boom",
				"interrupted": false,
				"exitCode":   1,
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
			"tool_name":  "Read",
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
			"tool_name":  "Read",
			"tool_use_id": "tu-4",
			"cwd":        "/home/user/proj",
			"tool_input": map[string]any{
				"file_path": "/home/user/proj/README.md",
				"offset":    1,
				"limit":     120,
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "e2", "tu-4",
		time.Date(2026, 6, 30, 12, 0, 0, 13_000_000, time.UTC),
		map[string]any{
			"tool_name":  "Read",
			"tool_use_id": "tu-4",
			"tool_response": map[string]any{
				"filePath":   "/home/user/proj/README.md",
				"numLines":   120,
				"startLine":  1,
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
			"tool_name":  "Read",
			"tool_use_id": "tu-9",
			"cwd":        "/home/user/proj",
			"tool_input": map[string]any{
				"file_path": "/home/user/proj/README.md",
				"offset":    1,
				"limit":     120,
			},
		},
	)
	post := hookEventFromPayload(t, "PostToolUse", "s1", "e2", "tu-9",
		time.Date(2026, 6, 30, 12, 0, 0, 13_000_000, time.UTC),
		map[string]any{
			"tool_name":  "Read",
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
	out := processInput("Edit", map[string]any{
		"file_path":  "/x",
		"old_string": long,
		"new_string": long,
	}, nil, "")
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
