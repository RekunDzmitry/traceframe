package main

import (
	"testing"
	"time"
)

// Tests for the display logic ported out of static/index.html. The grouping
// cases mirror the node assertions that were written against the JS original;
// the filter and tool-dropdown cases replace the four in-page browser
// self-tests, which could only ever run in a real browser.

const groupBaseTime = "2026-07-30T12:42:50.000Z"

func promptAt(id, content string, offset time.Duration) *eventSummary {
	base, err := time.Parse(time.RFC3339Nano, groupBaseTime)
	if err != nil {
		panic(err)
	}
	return &eventSummary{
		EventID:   id,
		EventTime: base.Add(offset).Format(time.RFC3339Nano),
		Kind:      kindUserPrompt,
		Content:   content,
	}
}

func toolsN(n int) []eventSummary {
	out := make([]eventSummary, n)
	for i := range out {
		out[i] = eventSummary{Kind: kindTool}
	}
	return out
}

func groupIDs(groups []userMessageGroup) []string {
	ids := make([]string, len(groups))
	for i, g := range groups {
		ids[i] = g.ID
	}
	return ids
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestGroupTurnsByUserMessage(t *testing.T) {
	frag := "Ok, now you have the general picture. Let's implement."
	full := frag + " Plan a local branch and a worktree creation"

	tests := []struct {
		name          string
		turns         []turn
		wantIDs       []string
		wantTurnCount []int
		wantToolCount []int
	}{
		{
			name:          "empty timeline",
			turns:         nil,
			wantIDs:       nil,
			wantTurnCount: nil,
			wantToolCount: nil,
		},
		{
			name: "one prompt spanning several turns",
			turns: []turn{
				{Prompt: promptAt("a", "hi", 0), Tools: toolsN(1)},
				{Tools: toolsN(2)},
				{Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-a"},
			wantTurnCount: []int{3},
			wantToolCount: []int{4},
		},
		{
			name: "turns before any prompt form an orphan group",
			turns: []turn{
				{Tools: toolsN(1)},
				{Prompt: promptAt("a", "hi", 0), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-orphan", "ug-a"},
			wantTurnCount: []int{1, 1},
			wantToolCount: []int{1, 1},
		},
		{
			name: "injected prompts are absorbed, not group heads",
			turns: []turn{
				{Prompt: promptAt("a", "real message", 0), Tools: toolsN(1)},
				{Prompt: promptAt("n1", "<task-notification>\n<task-id>x</task-id>", time.Second), Tools: toolsN(1)},
				{Prompt: promptAt("n2", "<system-reminder>blah", 2*time.Second), Tools: toolsN(2)},
				{Prompt: promptAt("b", "next real", 5*time.Minute), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-a", "ug-b"},
			wantTurnCount: []int{3, 1},
			wantToolCount: []int{4, 1},
		},
		{
			name: "leading whitespace before an injected tag is tolerated",
			turns: []turn{
				{Prompt: promptAt("n", "  \n<bash-input>pwd", 0)},
			},
			wantIDs:       []string{"ug-orphan"},
			wantTurnCount: []int{1},
			wantToolCount: []int{0},
		},
		{
			name: "a tag mid-text still heads a group",
			turns: []turn{
				{Prompt: promptAt("a", "see <task-notification> inline", 0)},
			},
			wantIDs:       []string{"ug-a"},
			wantTurnCount: []int{1},
			wantToolCount: []int{0},
		},
		{
			name: "superseded fragment folds into the completed message",
			turns: []turn{
				{Prompt: promptAt("f", frag, 0)},
				{Prompt: promptAt("c", full, 16*time.Second), Tools: toolsN(2)},
			},
			wantIDs:       []string{"ug-c"},
			wantTurnCount: []int{2},
			wantToolCount: []int{2},
		},
		{
			name: "a chain of edits collapses to the final submission",
			turns: []turn{
				{Prompt: promptAt("x", "aa", 0)},
				{Prompt: promptAt("y", "aabb", 5*time.Second)},
				{Prompt: promptAt("z", "aabbcc", 10*time.Second), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-z"},
			wantTurnCount: []int{3},
			wantToolCount: []int{1},
		},
		{
			name: "a prefix that already ran tools is a real message",
			turns: []turn{
				{Prompt: promptAt("f", frag, 0), Tools: toolsN(1)},
				{Prompt: promptAt("c", full, 16*time.Second), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-f", "ug-c"},
			wantTurnCount: []int{1, 1},
			wantToolCount: []int{1, 1},
		},
		{
			name: "a prefix outside the window is a real message",
			turns: []turn{
				{Prompt: promptAt("f", frag, 0)},
				{Prompt: promptAt("c", full, 10*time.Minute), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-f", "ug-c"},
			wantTurnCount: []int{1, 1},
			wantToolCount: []int{0, 1},
		},
		{
			name: "an identical repeat is not a strict prefix",
			turns: []turn{
				{Prompt: promptAt("f", frag, 0)},
				{Prompt: promptAt("c", frag, 5*time.Second), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-f", "ug-c"},
			wantTurnCount: []int{1, 1},
			wantToolCount: []int{0, 1},
		},
		{
			name: "unrelated consecutive prompts stay separate",
			turns: []turn{
				{Prompt: promptAt("f", "alpha", 0)},
				{Prompt: promptAt("c", "beta", 5*time.Second), Tools: toolsN(1)},
			},
			wantIDs:       []string{"ug-f", "ug-c"},
			wantTurnCount: []int{1, 1},
			wantToolCount: []int{0, 1},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			groups := groupTurnsByUserMessage(tc.turns)
			if got := groupIDs(groups); !equalStrings(got, tc.wantIDs) {
				t.Fatalf("group ids = %v, want %v", got, tc.wantIDs)
			}
			for i, g := range groups {
				if len(g.Turns) != tc.wantTurnCount[i] {
					t.Errorf("group %s: %d turns, want %d", g.ID, len(g.Turns), tc.wantTurnCount[i])
				}
				if g.ToolCount != tc.wantToolCount[i] {
					t.Errorf("group %s: %d tools, want %d", g.ID, g.ToolCount, tc.wantToolCount[i])
				}
			}
		})
	}
}

func TestGroupHeaderKeepsTypedPromptNotInjected(t *testing.T) {
	groups := groupTurnsByUserMessage([]turn{
		{Prompt: promptAt("a", "real message", 0)},
		{Prompt: promptAt("n", "<task-notification>report", time.Second)},
	})
	if len(groups) != 1 {
		t.Fatalf("got %d groups, want 1", len(groups))
	}
	if groups[0].Prompt == nil || groups[0].Prompt.Content != "real message" {
		t.Errorf("header prompt = %+v, want the typed message", groups[0].Prompt)
	}
}

// The min-duration carve-out: it must apply to tool events only. Filtering
// prompts and responses on a duration they never carry silently emptied the
// view. This replaces browser self-tests 1 and 2.
func TestFiltersMinDurationAppliesToToolsOnly(t *testing.T) {
	ms := func(v int64) *int64 { return &v }
	events := []eventSummary{
		{EventID: "p1", Kind: kindUserPrompt},
		{EventID: "r1", Kind: kindAssistantStop},
		{EventID: "t1", Kind: kindTool, ToolName: "Read", DurationMS: ms(100)},
		{EventID: "t2", Kind: kindTool, ToolName: "Bash", DurationMS: ms(5000)},
	}
	got := timelineFilters{MinDuration: 1000}.Apply(events)

	kept := map[string]bool{}
	for _, ev := range got {
		kept[ev.EventID] = true
	}
	for _, id := range []string{"p1", "r1", "t2"} {
		if !kept[id] {
			t.Errorf("%s was dropped; non-tool rows and slow tools must survive", id)
		}
	}
	if kept["t1"] {
		t.Error("t1 (100ms) survived a 1000ms minimum")
	}
}

func TestFiltersApply(t *testing.T) {
	ms := func(v int64) *int64 { return &v }
	events := []eventSummary{
		{EventID: "ok", Kind: kindTool, ToolName: "Read", Status: statusOK,
			Input: map[string]any{"file_path": "/repo/static/index.html"}, DurationMS: ms(50)},
		{EventID: "bad", Kind: kindTool, ToolName: "Bash", Status: statusError,
			Output: map[string]any{"filePath": "/repo/main.go"}, DurationMS: ms(9000)},
		{EventID: "prompt", Kind: kindUserPrompt},
	}

	tests := []struct {
		name   string
		filter timelineFilters
		want   []string
	}{
		{"no filter keeps everything", timelineFilters{}, []string{"ok", "bad", "prompt"}},
		{"failures only", timelineFilters{Failures: true}, []string{"bad"}},
		{"by kind", timelineFilters{Kind: kindUserPrompt}, []string{"prompt"}},
		{"by tool", timelineFilters{Tool: "Read"}, []string{"ok"}},
		{"file matches input.file_path", timelineFilters{File: "index.html"}, []string{"ok"}},
		{"file falls back to output.filePath", timelineFilters{File: "main.go"}, []string{"bad"}},
		// Unlike min-duration, the file filter has no carve-out for rows that
		// carry no path: a prompt has nothing to match, so it is dropped.
		// Faithful to the JS this replaces.
		{"file filter drops rows without a path", timelineFilters{File: "main.go"}, []string{"bad"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got []string
			for _, ev := range tc.filter.Apply(events) {
				got = append(got, ev.EventID)
			}
			if !equalStrings(got, tc.want) {
				t.Errorf("kept %v, want %v", got, tc.want)
			}
		})
	}
}

// The stored filter is lowercased by the caller; the event's path is not, so
// the comparison has to lower it too.
func TestFileFilterIgnoresPathCase(t *testing.T) {
	events := []eventSummary{
		{EventID: "mixed", Kind: kindTool, Input: map[string]any{"file_path": "/repo/Static/INDEX.html"}},
	}
	got := timelineFilters{File: "static/index.html"}.Apply(events)
	if len(got) != 1 || got[0].EventID != "mixed" {
		t.Errorf("kept %d events, want the mixed-case path to match", len(got))
	}
}

func TestFiltersActive(t *testing.T) {
	tests := []struct {
		name   string
		filter timelineFilters
		want   bool
	}{
		{"zero value", timelineFilters{}, false},
		{"failures", timelineFilters{Failures: true}, true},
		{"kind", timelineFilters{Kind: kindTool}, true},
		{"tool", timelineFilters{Tool: "Bash"}, true},
		{"min duration", timelineFilters{MinDuration: 1}, true},
		{"zero min duration is inactive", timelineFilters{MinDuration: 0}, false},
		{"file", timelineFilters{File: "x"}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.filter.Active(); got != tc.want {
				t.Errorf("Active() = %v, want %v", got, tc.want)
			}
		})
	}
}

// Replaces browser self-tests 3 and 4.
func TestResolveToolFilterDropsVanishedSelection(t *testing.T) {
	available := toolNames([]eventSummary{
		{ToolName: "Read"}, {ToolName: "Write"}, {ToolName: "Read"}, {Kind: kindUserPrompt},
	})
	if !equalStrings(available, []string{"Read", "Write"}) {
		t.Fatalf("toolNames = %v, want sorted and deduped [Read Write]", available)
	}
	if got := resolveToolFilter("Read", available); got != "Read" {
		t.Errorf("a still-present selection = %q, want %q", got, "Read")
	}
	if got := resolveToolFilter("NotPresent", available); got != "" {
		t.Errorf("a vanished selection = %q, want it cleared", got)
	}
	if got := resolveToolFilter("", available); got != "" {
		t.Errorf("empty selection = %q, want empty", got)
	}
}

func TestRowPresentation(t *testing.T) {
	ms := func(v int64) *int64 { return &v }

	if got := summaryFor(eventSummary{Kind: kindUserPrompt, Content: ""}); got != "(empty prompt)" {
		t.Errorf("empty prompt summary = %q", got)
	}
	if got := summaryFor(eventSummary{Kind: kindUserPrompt, Content: "line one\nline two"}); got != "line one" {
		t.Errorf("prompt summary = %q, want first line only", got)
	}
	if got := summaryFor(eventSummary{Kind: kindPermissionReq, ToolName: "Bash"}); got != "request permission for Bash" {
		t.Errorf("permission summary = %q", got)
	}
	if got := summaryFor(eventSummary{Kind: kindTool, ToolName: "Read"}); got != "Read" {
		t.Errorf("tool summary fallback = %q", got)
	}

	if got := iconFor(eventSummary{Kind: kindTool, Status: statusError}); got != "!" {
		t.Errorf("error icon = %q", got)
	}
	if got := iconFor(eventSummary{Kind: kindUserPrompt}); got != "·" {
		t.Errorf("non-tool icon = %q", got)
	}

	if got := durationFor(eventSummary{Kind: kindTool, DurationMS: ms(999)}); got != "999ms" {
		t.Errorf("sub-second duration = %q", got)
	}
	if got := durationFor(eventSummary{Kind: kindTool, DurationMS: ms(1500)}); got != "1.50s" {
		t.Errorf("duration = %q", got)
	}
	if got := durationFor(eventSummary{Kind: kindTool}); got != "" {
		t.Errorf("missing duration = %q, want empty", got)
	}
	if got := durationFor(eventSummary{Kind: kindUserPrompt, DurationMS: ms(50)}); got != "" {
		t.Errorf("non-tool duration = %q, want empty", got)
	}

	chips := chipsFor(eventSummary{Kind: kindTool, Status: statusError, Error: "exit 1", Effort: "high"})
	if len(chips) != 2 || chips[0].Tone != "error" || chips[0].Text != "error: exit 1" || chips[1].Text != "effort: high" {
		t.Errorf("chips = %+v", chips)
	}
	if chipsFor(eventSummary{Kind: kindUserPrompt, Status: statusOK}) != nil {
		t.Error("non-tool events must have no chips")
	}

	if got := humanKind("user_prompt"); got != "user prompt" {
		t.Errorf("humanKind = %q", got)
	}
}

// The byte-based truncate is right for capping payload sizes but wrong for
// display: slicing bytes mid-character emits a replacement glyph.
func TestTruncateRunesDoesNotSplitCharacters(t *testing.T) {
	const s = "héllo wörld"
	if got := truncateRunes(s, 5); got != "héllo…" {
		t.Errorf("truncateRunes = %q, want %q", got, "héllo…")
	}
	if got := truncateRunes(s, 100); got != s {
		t.Errorf("under the limit = %q, want unchanged", got)
	}
	if got := truncateRunes("日本語テキスト", 3); got != "日本語…" {
		t.Errorf("multibyte truncate = %q", got)
	}
}
