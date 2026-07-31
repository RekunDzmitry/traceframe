package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/a-h/templ"
)

func TestParseRenderContextDefaultsToAllSessions(t *testing.T) {
	rc := parseRenderContext(httptest.NewRequest(http.MethodGet, "/ui/main", nil))
	if rc.SelectedSession != allSessionsID {
		t.Errorf("session = %q, want %q", rc.SelectedSession, allSessionsID)
	}
	if rc.Loc != time.UTC {
		t.Errorf("zone = %v, want UTC without a cookie", rc.Loc)
	}
	if rc.CursorSet {
		t.Error("cursor set without a step parameter")
	}
}

// step=0 (show nothing) and no step at all (show everything) are different
// states that a bare int cursor cannot tell apart.
func TestParseRenderContextCursor(t *testing.T) {
	for _, tc := range []struct {
		url    string
		cursor int
		set    bool
	}{
		{"/ui/timeline?session=s", 0, false},
		{"/ui/timeline?session=s&step=0", 0, true},
		{"/ui/timeline?session=s&step=7", 7, true},
		{"/ui/timeline?session=s&step=bogus", 0, false},
	} {
		rc := parseRenderContext(httptest.NewRequest(http.MethodGet, tc.url, nil))
		if rc.Cursor != tc.cursor || rc.CursorSet != tc.set {
			t.Errorf("%s -> cursor %d/set %v, want %d/%v", tc.url, rc.Cursor, rc.CursorSet, tc.cursor, tc.set)
		}
	}
}

func TestParseFiltersFromQuery(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/ui/timeline?failures=1&kind=tool&tool=Bash&min_duration=250&file=Static/App.CSS", nil)
	f := parseRenderContext(r).Filters
	if !f.Failures || f.Kind != "tool" || f.Tool != "Bash" || f.MinDuration != 250 {
		t.Errorf("filters = %+v", f)
	}
	// Apply compares against a lowercased path, so the query has to be
	// folded on the way in or the file filter silently matches nothing.
	if f.File != "static/app.css" {
		t.Errorf("file = %q, want it lowercased", f.File)
	}
	if !f.Active() {
		t.Error("Active() = false for a fully populated filter set")
	}
}

// Disclosure ids are joined with ',', which a raw cookie value may not carry,
// so the round trip has to be encoded.
func TestOpenCookieRoundTrip(t *testing.T) {
	w := httptest.NewRecorder()
	writeOpenCookie(w, map[string]bool{"ug-abc": true, "row-def": true, "ug-closed": false})

	r := httptest.NewRequest(http.MethodGet, "/ui/main", nil)
	for _, c := range w.Result().Cookies() {
		r.AddCookie(c)
	}
	open := parseOpenCookie(r)
	if !open["ug-abc"] || !open["row-def"] {
		t.Errorf("open = %v, want both expanded ids", open)
	}
	if open["ug-closed"] {
		t.Error("a collapsed id was persisted")
	}
}

func TestTimezoneCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/ui/main", nil)
	r.AddCookie(&http.Cookie{Name: cookieTZ, Value: "Europe%2FWarsaw"})
	loc := parseTimezoneCookie(r)
	if loc == nil || loc.String() != "Europe/Warsaw" {
		t.Fatalf("zone = %v, want Europe/Warsaw", loc)
	}

	bad := httptest.NewRequest(http.MethodGet, "/ui/main", nil)
	bad.AddCookie(&http.Cookie{Name: cookieTZ, Value: "Not/AZone"})
	if got := parseTimezoneCookie(bad); got != time.UTC {
		t.Errorf("unknown zone = %v, want the UTC fallback", got)
	}
}

func TestBuildTotals(t *testing.T) {
	totals := buildTotals([]sidebarSession{
		{ID: "a", Count: 10, Tools: 4, Failures: 1, LastEvent: "2026-07-31T10:00:00Z"},
		{ID: "b", Count: 5, Tools: 2, LastEvent: "2026-07-31T12:00:00Z"},
	})
	if totals.ID != allSessionsID || totals.Name != "All sessions" {
		t.Errorf("totals identity = %q/%q", totals.ID, totals.Name)
	}
	if totals.Count != 15 || totals.Tools != 6 || totals.Failures != 1 {
		t.Errorf("totals = %+v", totals)
	}
	if totals.LastEvent != "2026-07-31T12:00:00Z" {
		t.Errorf("LastEvent = %q, want the newest session's", totals.LastEvent)
	}
}

func TestReplayStepURLEscapesSession(t *testing.T) {
	rc := renderContext{SelectedSession: "a b/c"}
	if got := replayStepURL(rc, 3); got != "/ui/timeline?session=a+b%2Fc&step=3" {
		t.Errorf("replayStepURL = %q", got)
	}
	if got := replayStepURL(rc, -1); got != "/ui/timeline?session=a+b%2Fc&step=0" {
		t.Errorf("negative step = %q, want it clamped to 0", got)
	}
}

func TestFlattenTimelineIncludesNotes(t *testing.T) {
	tl := timelineResponse{Turns: []turn{{
		Prompt:   &eventSummary{EventID: "p"},
		Tools:    []eventSummary{{EventID: "t"}},
		Notes:    []eventSummary{{EventID: "n"}},
		Response: &eventSummary{EventID: "r"},
	}}}
	got := flattenTimeline(tl)
	if len(got) != 4 {
		t.Fatalf("flattenTimeline = %d rows, want 4", len(got))
	}
	// Notes are excluded from the replayer but must stay reachable here, or
	// the drawer cannot open a row the timeline never draws.
	var seenNote bool
	for _, ev := range got {
		if ev.EventID == "n" {
			seenNote = true
		}
	}
	if !seenNote {
		t.Error("notes dropped from the row lookup")
	}
}

// The delete button targets #app, so its endpoint must answer with the rebuilt
// page. Pointing it at the JSON API would swap `{"ok":true}` into the app
// shell and leave the UI dead until a reload.
func TestDeleteButtonTargetsTheUIEndpoint(t *testing.T) {
	session := sessionSummary{ID: "sess a/b", Name: "demo", EventCount: 3}
	var buf bytes.Buffer
	body := templ.NopComponent
	if err := EventsPanel(renderContext{SelectedSession: session.ID}, "demo", &session, nil, body).Render(context.Background(), &buf); err != nil {
		t.Fatal(err)
	}
	html := buf.String()
	if strings.Contains(html, `hx-delete="/api/`) {
		t.Error("delete button points at the JSON API; its response would be swapped into #app")
	}
	if !strings.Contains(html, "/ui/sessions/delete?session=sess+a%2Fb") {
		t.Errorf("delete button target missing or unescaped:\n%s", html)
	}
}

func TestUIDeleteRejectsNonDelete(t *testing.T) {
	s := &server{}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		w := httptest.NewRecorder()
		s.handleUIDeleteSession(w, httptest.NewRequest(method, "/ui/sessions/delete?session=x", nil))
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s -> %d, want 405", method, w.Code)
		}
	}
	// "all" is the sidebar's pseudo-session, not a row set to drop.
	w := httptest.NewRecorder()
	s.handleUIDeleteSession(w, httptest.NewRequest(http.MethodDelete, "/ui/sessions/delete?session=all", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("deleting %q -> %d, want 404", allSessionsID, w.Code)
	}
	w = httptest.NewRecorder()
	s.handleUIDeleteSession(w, httptest.NewRequest(http.MethodDelete, "/ui/sessions/delete", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("missing session -> %d, want 404", w.Code)
	}
}
