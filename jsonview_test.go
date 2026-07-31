package main

import (
	"strings"
	"testing"
)

// The JS walked the parsed payload with Object.keys, which preserves insertion
// order. Decoding into a Go map would randomise it and reshuffle the drawer on
// every render, so the decoder keeps the original order.
func TestParseJSONNodePreservesKeyOrder(t *testing.T) {
	raw := []byte(`{"zebra":1,"apple":2,"middle":3,"beta":4}`)
	node, err := parseJSONNode(raw)
	if err != nil {
		t.Fatalf("parseJSONNode: %v", err)
	}
	want := []string{"zebra", "apple", "middle", "beta"}
	if len(node.Keys) != len(want) {
		t.Fatalf("got %d keys, want %d", len(node.Keys), len(want))
	}
	for i, key := range want {
		if node.Keys[i] != key {
			t.Errorf("key %d = %q, want %q (document order, not sorted)", i, node.Keys[i], key)
		}
	}
	// Repeat: a map-based decode would fail this intermittently.
	for i := 0; i < 20; i++ {
		again, _ := parseJSONNode(raw)
		for j, key := range want {
			if again.Keys[j] != key {
				t.Fatalf("run %d: key %d = %q, want %q", i, j, again.Keys[j], key)
			}
		}
	}
}

func TestParseJSONNodeShapes(t *testing.T) {
	node, err := parseJSONNode([]byte(`{"s":"hi","n":42,"f":1.5,"b":true,"nil":null,"arr":[1,2],"obj":{}}`))
	if err != nil {
		t.Fatalf("parseJSONNode: %v", err)
	}
	if node.Kind != jsonObject || node.Label() != "Object(7)" {
		t.Fatalf("root = %s %s", node.Kind, node.Label())
	}
	byKey := map[string]jsonNode{}
	for i, k := range node.Keys {
		byKey[k] = node.Children[i]
	}
	tests := []struct{ key, display, class string }{
		{"s", `"hi"`, "json-string"},
		{"n", "42", "json-number"},
		{"f", "1.5", "json-number"},
		{"b", "true", "json-boolean"},
		{"nil", "null", "json-null"},
	}
	for _, tc := range tests {
		got := byKey[tc.key]
		if got.Display != tc.display || got.Class != tc.class {
			t.Errorf("%s = %q/%q, want %q/%q", tc.key, got.Display, got.Class, tc.display, tc.class)
		}
	}
	if byKey["arr"].Label() != "Array(2)" {
		t.Errorf("array label = %q", byKey["arr"].Label())
	}
	if byKey["obj"].Label() != "Object(0)" {
		t.Errorf("empty object label = %q", byKey["obj"].Label())
	}
}

func TestJSONChildPath(t *testing.T) {
	node, err := parseJSONNode([]byte(`{"tool_input":{"file_path":"/x"},"list":[10,20]}`))
	if err != nil {
		t.Fatalf("parseJSONNode: %v", err)
	}
	if got := node.ChildPath("$", 0); got != "$.tool_input" {
		t.Errorf("object child path = %q", got)
	}
	arr := node.Children[1]
	if got := arr.ChildPath("$.list", 1); got != "$.list[1]" {
		t.Errorf("array child path = %q", got)
	}
}

// The JS escaped the whole string and then ran the highlight regex over the
// result, so a match could land inside an entity such as `&amp;` and emit
// broken markup. Splitting first and letting the template escape each segment
// removes the failure mode entirely.
func TestHighlightSegments(t *testing.T) {
	tests := []struct {
		name string
		text string
		term string
		want []textSegment
	}{
		{"no term", "hello", "", []textSegment{{Text: "hello"}}},
		{"no match", "hello", "zz", []textSegment{{Text: "hello"}}},
		{"single match", "hello", "ell", []textSegment{{Text: "h"}, {Text: "ell", Match: true}, {Text: "o"}}},
		{"case-insensitive keeps original case", "Hello", "hello", []textSegment{{Text: "Hello", Match: true}}},
		{"repeated", "aXaXa", "x", []textSegment{
			{Text: "a"}, {Text: "X", Match: true}, {Text: "a"}, {Text: "X", Match: true}, {Text: "a"},
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := highlightSegments(tc.text, tc.term)
			if len(got) != len(tc.want) {
				t.Fatalf("got %d segments %+v, want %d", len(got), got, len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("segment %d = %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestHighlightSegmentsLeavesEntitiesIntact(t *testing.T) {
	// "&" is what the old escape-then-highlight order mangled: it became
	// "&amp;" and a search for "amp" would then match inside the entity.
	got := highlightSegments("a & b", "amp")
	if len(got) != 1 || got[0].Match {
		t.Errorf("segments = %+v, want the raw text unmatched", got)
	}
}

func TestFormatValueDispatch(t *testing.T) {
	tests := []struct {
		name      string
		value     any
		wantText  string
		wantBlock bool
		wantClass string
	}{
		{"nil", nil, "null", false, ""},
		{"short string is quoted inline", "hi", `"hi"`, false, "code-inline"},
		{"long string becomes a block", strings.Repeat("x", 201), strings.Repeat("x", 201), true, ""},
		{"bool", true, "true", false, ""},
		{"number", float64(42), "42", false, ""},
		{"empty array", []any{}, "[]", false, ""},
		{"scalar array becomes bullets", []any{"a", float64(2)}, "• a\n• 2", true, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := formatValue(tc.value)
			if got.Text != tc.wantText || got.Block != tc.wantBlock || got.Class != tc.wantClass {
				t.Errorf("formatValue = %+v, want text=%q block=%v class=%q",
					got, tc.wantText, tc.wantBlock, tc.wantClass)
			}
		})
	}
	if got := formatValue(map[string]any{"a": float64(1)}); !got.Block || !strings.Contains(got.Text, `"a"`) {
		t.Errorf("object = %+v, want a pretty-printed block", got)
	}
}

// startLine is zero-based in the tool's output but one-based in the display.
func TestReadMetaOffByOne(t *testing.T) {
	got := readMeta(map[string]any{
		"filePath": "/repo/main.go", "startLine": float64(0), "numLines": float64(12),
	})
	if got != "/repo/main.go · lines 1–12" {
		t.Errorf("readMeta = %q", got)
	}
	got = readMeta(map[string]any{"filePath": "/x", "startLine": float64(10), "numLines": float64(5)})
	if got != "/x · lines 11–15" {
		t.Errorf("readMeta = %q", got)
	}
	if got := readMeta(map[string]any{"filePath": "/x"}); got != "/x" {
		t.Errorf("readMeta without a range = %q", got)
	}
}

func TestStructuredPatch(t *testing.T) {
	ev := eventSummary{Output: map[string]any{
		"structuredPatch": []any{map[string]any{
			"oldStart": float64(3), "oldLines": float64(2),
			"newStart": float64(3), "newLines": float64(4),
			"lines": []any{" ctx", "-gone", "+added"},
		}},
	}}
	hunks := structuredPatch(ev)
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks, want 1", len(hunks))
	}
	if got := hunks[0].Header(); got != "@@ -3,2 +3,4 @@" {
		t.Errorf("header = %q", got)
	}
	wantClasses := []string{"context", "remove", "add"}
	for i, line := range hunks[0].Lines {
		if got := diffLineClass(line); got != wantClasses[i] {
			t.Errorf("line %q class = %q, want %q", line, got, wantClasses[i])
		}
	}
	if structuredPatch(eventSummary{}) != nil {
		t.Error("a missing patch must yield no hunks")
	}
}

func TestBuildSessionsAggregatesAndOrders(t *testing.T) {
	hooks := []eventSummary{
		{SessionID: "a", SessionName: "alpha", EventTime: "2026-07-30T10:00:00Z", Kind: kindTool, Status: statusOK},
		{SessionID: "a", SessionName: "alpha", EventTime: "2026-07-30T12:00:00Z", Kind: kindTool, Status: statusError},
		{SessionID: "b", SessionName: "beta", EventTime: "2026-07-30T11:00:00Z", Kind: kindUserPrompt},
	}
	sessions := buildSessions(hooks)
	if len(sessions) != 2 {
		t.Fatalf("got %d sessions, want 2", len(sessions))
	}
	if sessions[0].ID != "a" {
		t.Errorf("first session = %q, want the most recent (a)", sessions[0].ID)
	}
	if sessions[0].Count != 2 || sessions[0].Tools != 2 || sessions[0].Failures != 1 {
		t.Errorf("alpha totals = %+v", sessions[0])
	}
	if got := sessions[0].Meta(); got != "2 events · 2 tools · 1 failure" {
		t.Errorf("meta = %q", got)
	}
	if got := sessions[1].Meta(); got != "1 event" {
		t.Errorf("beta meta = %q, want singular and no zero counts", got)
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		ms   int64
		want string
	}{
		{0, "—"},
		{-5, "—"},
		{999, "999ms"},
		{1500, "1.5s"},
		{65000, "1m 5s"},
	}
	for _, tc := range tests {
		if got := formatDuration(tc.ms); got != tc.want {
			t.Errorf("formatDuration(%d) = %q, want %q", tc.ms, got, tc.want)
		}
	}
}

func TestGroupTitle(t *testing.T) {
	if got := groupTitle(userMessageGroup{}); got != "Before first prompt" {
		t.Errorf("orphan title = %q", got)
	}
	g := userMessageGroup{Prompt: &eventSummary{Content: "first line\nsecond"}}
	if got := groupTitle(g); got != "first line" {
		t.Errorf("title = %q", got)
	}
	if got := groupTitle(userMessageGroup{Prompt: &eventSummary{Content: "   "}}); got != "(empty prompt)" {
		t.Errorf("blank prompt title = %q", got)
	}
}
