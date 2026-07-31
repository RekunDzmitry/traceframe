package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func usageEvents(t *testing.T, cwd string) []*hookEvent {
	t.Helper()
	at := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	return []*hookEvent{{
		EventID:   "s1",
		EventName: "SessionStart",
		SessionID: "sess",
		EventTime: at,
		Payload: map[string]any{
			"cwd":           cwd,
			"system_prompt": "you are a helpful agent",
			"model":         "claude-opus-4-8",
		},
	}}
}

func TestEstimateTokensRoundsUp(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want int64
	}{{"", 0}, {"a", 1}, {"abcd", 1}, {"abcde", 2}, {"héllo wörld", 3}} {
		if got := estimateTokens(tc.in); got != tc.want {
			t.Errorf("estimateTokens(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestFormatTokens(t *testing.T) {
	for _, tc := range []struct {
		in   int64
		want string
	}{{0, "0"}, {482, "482"}, {4200, "4.2k"}, {17000, "17k"}, {933_000, "933k"}, {1_200_000, "1.2M"}} {
		if got := formatTokens(tc.in); got != tc.want {
			t.Errorf("formatTokens(%d) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// The panel's whole point is that it moves with the replayer: revealing more
// rows must never shrink the conversation's share of the window.
func TestMessagesGrowWithTheCursor(t *testing.T) {
	groups := replayFixture()
	groups[0].Turns[0].Prompt.Content = "a fairly long user message about the task"
	groups[0].Turns[0].Response.Content = "an equally long assistant response about it"
	events := usageEvents(t, t.TempDir())

	var previous int64 = -1
	for cursor := 0; cursor <= len(replayOrder(groups)); cursor++ {
		usage := buildUsageBreakdown(events, flattenRows(truncateToCursor(groups, cursor)))
		messages := categoryByName(t, usage, "Messages")
		if messages.Tokens < previous {
			t.Fatalf("cursor %d: messages fell from %d to %d", cursor, previous, messages.Tokens)
		}
		previous = messages.Tokens
	}
	if previous == 0 {
		t.Fatal("messages never grew past zero")
	}
}

func TestFreeSpaceIsWindowMinusTotal(t *testing.T) {
	usage := buildUsageBreakdown(usageEvents(t, t.TempDir()), flattenRows(replayFixture()))
	if usage.Window != 1_000_000 {
		t.Fatalf("window = %d, want the Opus 4.8 window", usage.Window)
	}
	free := categoryByName(t, usage, "Free space")
	if got := usage.Total + free.Tokens; got != usage.Window {
		t.Errorf("total(%d) + free(%d) = %d, want window %d", usage.Total, free.Tokens, got, usage.Window)
	}
}

// A measured context snapshot beats the character heuristic, and the bulk
// category absorbs the difference rather than the panel showing two totals.
func TestMeasuredTotalWins(t *testing.T) {
	groups := replayFixture()
	groups[0].Turns[0].Tools[0].ContextTokens = 41_700
	groups[0].Turns[0].Tools[0].ContextWindow = 200_000
	usage := buildUsageBreakdown(usageEvents(t, t.TempDir()), flattenRows(truncateToCursor(groups, 2)))
	if !usage.Measured {
		t.Fatal("snapshot on a revealed row was ignored")
	}
	if usage.Total != 41_700 || usage.Window != 200_000 {
		t.Fatalf("total/window = %d/%d, want 41700/200000", usage.Total, usage.Window)
	}
	var sum int64
	for _, c := range usage.Categories {
		if c.Name != "Free space" {
			sum += c.Tokens
		}
	}
	if sum != usage.Total {
		t.Errorf("categories sum to %d, want the measured total %d", sum, usage.Total)
	}
}

func TestSystemPromptNoteWhenNotCaptured(t *testing.T) {
	events := usageEvents(t, t.TempDir())
	delete(events[0].Payload, "system_prompt")
	usage := buildUsageBreakdown(events, nil)
	prompt := categoryByName(t, usage, "System prompt")
	if prompt.Tokens != 0 || prompt.Note == "" {
		t.Errorf("system prompt = %+v, want 0 tokens with an explanatory note", prompt)
	}
}

func TestAgentsAndMemoryReadFromDisk(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TRACEFRAME_PROJECT_ROOT", root)
	mustWrite(t, filepath.Join(root, ".claude", "agents", "reviewer.md"), "review carefully and at length")
	mustWrite(t, filepath.Join(root, "CLAUDE.md"), "project conventions live here")

	usage := buildUsageBreakdown(usageEvents(t, root), nil)
	if got := categoryByName(t, usage, "Custom agents"); got.Tokens == 0 {
		t.Error("custom agents did not pick up .claude/agents/reviewer.md")
	}
	if got := categoryByName(t, usage, "Memory files"); got.Tokens == 0 {
		t.Error("memory files did not pick up CLAUDE.md")
	}
}

// The path a category reads comes from a hook payload, i.e. from the agent
// being observed. It must not be able to point the reader outside the root.
func TestAllowedProjectFileRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	t.Setenv("TRACEFRAME_PROJECT_ROOT", root)

	inside := filepath.Join(root, "CLAUDE.md")
	mustWrite(t, inside, "ok")
	escape := filepath.Join(outside, "CLAUDE.md")
	mustWrite(t, escape, "secret")

	if _, ok := allowedProjectFile(inside); !ok {
		t.Error("rejected a file inside the root")
	}
	for _, path := range []string{
		escape,
		filepath.Join(root, "..", filepath.Base(outside), "CLAUDE.md"),
		"relative/CLAUDE.md",
		filepath.Join(root, "notes.txt"),
		"",
	} {
		if resolved, ok := allowedProjectFile(path); ok {
			t.Errorf("accepted %q (resolved %q), want rejection", path, resolved)
		}
	}
	if got := readFileTokens(escape); got != 0 {
		t.Errorf("readFileTokens read outside the root: %d", got)
	}
}

// A symlink inside the root pointing out of it is the escape EvalSymlinks
// exists to catch.
func TestAllowedProjectFileResolvesSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	t.Setenv("TRACEFRAME_PROJECT_ROOT", root)

	target := filepath.Join(outside, "secret.md")
	mustWrite(t, target, "secret")
	link := filepath.Join(root, "CLAUDE.md")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, ok := allowedProjectFile(link); ok {
		t.Error("accepted a symlink escaping the root")
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func categoryByName(t *testing.T, usage usageBreakdown, name string) usageCategory {
	t.Helper()
	for _, c := range usage.Categories {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("category %q missing from %+v", name, usage.Categories)
	return usageCategory{}
}

// A memory file whose whole body is `@RTK.md` costs two tokens on its own; the
// category is only meaningful if the import it delegates to is counted.
func TestMemoryFilesFollowImports(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TRACEFRAME_PROJECT_ROOT", root)
	mustWrite(t, filepath.Join(root, "CLAUDE.md"), "@RTK.md\n")
	imported := "a much longer set of conventions that dwarfs the pointer to it"
	mustWrite(t, filepath.Join(root, "RTK.md"), imported)

	usage := buildUsageBreakdown(usageEvents(t, root), nil)
	got := categoryByName(t, usage, "Memory files").Tokens
	if want := estimateTokens("@RTK.md\n") + estimateTokens(imported); got != want {
		t.Errorf("memory tokens = %d, want %d (pointer plus its import)", got, want)
	}
}

func TestMemoryImportsIgnoresProse(t *testing.T) {
	body := "@RTK.md\nemail me at a@b.md please\n@ notes.md\n@nested/guide.md\ntext @inline.md\n"
	got := memoryImports(body)
	want := []string{"RTK.md", "nested/guide.md"}
	if len(got) != len(want) {
		t.Fatalf("imports = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("import %d = %q, want %q", i, got[i], want[i])
		}
	}
}
