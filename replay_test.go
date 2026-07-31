package main

import (
	"strings"
	"testing"
)

// replayFixture is two user messages: the first ran two tools across two
// turns, the second is still waiting for a response. Rows in draw order:
// p1, t1, t2, r1, p1b(nil prompt) ... see want below.
func replayFixture() []userMessageGroup {
	ev := func(id, kind string) *eventSummary {
		return &eventSummary{EventID: id, Kind: kind}
	}
	return []userMessageGroup{
		{
			ID:     "ug-p1",
			Prompt: ev("p1", kindUserPrompt),
			Turns: []turn{
				{
					Prompt:   ev("p1", kindUserPrompt),
					Tools:    []eventSummary{{EventID: "t1", Kind: kindTool}, {EventID: "t2", Kind: kindTool}},
					Response: ev("r1", kindAssistantStop),
				},
				{
					Tools:    []eventSummary{{EventID: "t3", Kind: kindTool}},
					Response: ev("r2", kindAssistantStop),
				},
			},
			ToolCount: 3,
		},
		{
			ID:     "ug-p2",
			Prompt: ev("p2", kindUserPrompt),
			Turns: []turn{
				{
					Prompt: ev("p2", kindUserPrompt),
					Tools:  []eventSummary{{EventID: "t4", Kind: kindTool}},
				},
			},
			ToolCount: 1,
		},
	}
}

func TestReplayOrderIsDrawOrder(t *testing.T) {
	got := replayOrder(replayFixture())
	want := []string{"p1", "t1", "t2", "r1", "t3", "r2", "p2", "t4"}
	if len(got) != len(want) {
		t.Fatalf("replayOrder length = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// The replayer's contract: stepping to N reveals exactly N rows, and they are
// the first N of the full order. Everything else in the feature depends on it.
func TestTruncateToCursorRevealsExactlyNRows(t *testing.T) {
	groups := replayFixture()
	full := replayOrder(groups)
	for cursor := 0; cursor <= len(full)+2; cursor++ {
		revealed := replayOrder(truncateToCursor(groups, cursor))
		want := cursor
		if want > len(full) {
			want = len(full)
		}
		if len(revealed) != want {
			t.Fatalf("cursor %d revealed %d rows, want %d (%v)", cursor, len(revealed), want, revealed)
		}
		for i := range revealed {
			if revealed[i] != full[i] {
				t.Errorf("cursor %d row %d = %q, want %q", cursor, i, revealed[i], full[i])
			}
		}
	}
}

func TestTruncateToCursorZeroYieldsNothing(t *testing.T) {
	if got := truncateToCursor(replayFixture(), 0); len(got) != 0 {
		t.Fatalf("cursor 0 = %d groups, want 0", len(got))
	}
	if got := truncateToCursor(replayFixture(), -5); len(got) != 0 {
		t.Fatalf("negative cursor = %d groups, want 0", len(got))
	}
}

// Empty turns must not render: a turn whose rows are all still in the future
// would otherwise draw its header and an "Assistant: no response yet" block
// before anything in it has happened.
func TestTruncateToCursorDropsUnrevealedTurns(t *testing.T) {
	groups := truncateToCursor(replayFixture(), 2)
	if len(groups) != 1 {
		t.Fatalf("groups = %d, want 1", len(groups))
	}
	if len(groups[0].Turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(groups[0].Turns))
	}
	if got := groups[0].Turns[0]; got.Response != nil {
		t.Error("response revealed before its step")
	}
	if got := groups[0].ToolCount; got != 1 {
		t.Errorf("ToolCount = %d, want 1 (must count revealed tools only)", got)
	}
}

func TestClampCursor(t *testing.T) {
	for _, tc := range []struct{ cursor, total, want int }{
		{-1, 5, 0}, {0, 5, 0}, {3, 5, 3}, {5, 5, 5}, {9, 5, 5}, {1, 0, 0},
	} {
		if got := clampCursor(tc.cursor, tc.total); got != tc.want {
			t.Errorf("clampCursor(%d, %d) = %d, want %d", tc.cursor, tc.total, got, tc.want)
		}
	}
}

func TestFlattenRowsMatchesReplayOrder(t *testing.T) {
	groups := truncateToCursor(replayFixture(), 5)
	rows := flattenRows(groups)
	ids := replayOrder(groups)
	if len(rows) != len(ids) {
		t.Fatalf("flattenRows = %d rows, replayOrder = %d", len(rows), len(ids))
	}
	for i := range rows {
		if rows[i].EventID != ids[i] {
			t.Errorf("row %d = %q, want %q", i, rows[i].EventID, ids[i])
		}
	}
}

// An inactive filter must return the groups untouched -- the replayer counts
// rows off this result, so a filter that quietly rebuilt the list would shift
// every step position.
func TestApplyFiltersToGroupsInactiveIsIdentity(t *testing.T) {
	groups := replayFixture()
	got, matched := applyFiltersToGroups(groups, timelineFilters{})
	if matched != nil {
		t.Error("inactive filter reported matches")
	}
	if len(replayOrder(got)) != len(replayOrder(groups)) {
		t.Error("inactive filter changed the row set")
	}
}

func TestApplyFiltersToGroupsKeepsMatchesOnly(t *testing.T) {
	groups := replayFixture()
	groups[0].Turns[0].Tools[0].Status = statusError
	got, matched := applyFiltersToGroups(groups, timelineFilters{Failures: true})
	rows := replayOrder(got)
	if len(rows) != 1 || rows[0] != "t1" {
		t.Fatalf("filtered rows = %v, want [t1]", rows)
	}
	if !matched["t1"] {
		t.Error("matched set missing the row that passed the filter")
	}
	if len(got) != 1 || got[0].ToolCount != 1 {
		t.Errorf("group ToolCount = %v, want a single group counting 1 tool", got)
	}
}

// Group ids are interpolated into hx-target as `#<id>`. A ':' there is a
// pseudo-selector, so htmx resolves nothing and the disclosure silently stops
// toggling -- a failure with no error anywhere to point at it.
func TestGroupIDsAreValidCSSSelectors(t *testing.T) {
	groups := groupTurnsByUserMessage([]turn{
		{Tools: []eventSummary{{EventID: "t0", Kind: kindTool}}},
		{Prompt: &eventSummary{EventID: "9c1f-4d2a", Kind: kindUserPrompt, Content: "hi"}},
	})
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want 2", len(groups))
	}
	for _, group := range groups {
		if strings.ContainsAny(group.ID, ":.#[] ") {
			t.Errorf("group id %q is not usable as a bare #id selector", group.ID)
		}
		if !strings.HasPrefix(group.ID, "ug-") {
			t.Errorf("group id %q lost its prefix", group.ID)
		}
	}
}
