package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/a-h/templ"
)

// The /ui/* endpoints the templ components were written against. Until now
// they did not exist and static/index.html rebuilt the same views in the
// browser; these handlers replace that JS, so every view is server-rendered
// and htmx only swaps fragments.
//
// Each handler returns exactly the fragment its caller targets:
//
//	/ui/main          -> #app            whole two-panel body
//	/ui/sessions      -> #sessions       sidebar (5s poll)
//	/ui/timeline      -> #timeline-region  replayer + rows
//	/ui/groups/toggle -> #ug:<id>        one group, outerHTML
//	/ui/rows/toggle   -> #row-<id>       one row, outerHTML
//	/ui/raw           -> #drawer-content raw payload
const (
	// allSessionsID is the sentinel for the combined feed. It is not a real
	// session id, so it must never reach a WHERE clause.
	allSessionsID = "all"

	// cookieOpen records which disclosures are expanded and cookieTZ the
	// viewer's IANA zone. Expansion has to survive a server render, and the
	// server has no other way to learn either.
	cookieOpen = "tf_open"
	cookieTZ   = "tf_tz"

	// hookFeedLimit is how many rows the all-sessions view and the sidebar
	// aggregate over.
	hookFeedLimit = 300
)

// ---------- Request parsing ----------

func parseRenderContext(r *http.Request) renderContext {
	q := r.URL.Query()
	session := strings.TrimSpace(q.Get("session"))
	if session == "" {
		session = allSessionsID
	}
	rc := renderContext{
		SelectedSession: session,
		Filters:         parseFilters(q),
		Open:            parseOpenCookie(r),
		Loc:             parseTimezoneCookie(r),
	}
	// An absent step means "show the whole session"; step=0 means "show
	// nothing yet". Only a parsable value sets the cursor, so a corrupted
	// URL degrades to the full timeline rather than an empty one.
	if raw := strings.TrimSpace(q.Get("step")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			rc.Cursor, rc.CursorSet = n, true
		}
	}
	return rc
}

func parseFilters(q url.Values) timelineFilters {
	f := timelineFilters{
		Failures: q.Get("failures") == "1",
		Kind:     strings.TrimSpace(q.Get("kind")),
		Tool:     strings.TrimSpace(q.Get("tool")),
		File:     strings.ToLower(strings.TrimSpace(q.Get("file"))),
	}
	if n, err := strconv.ParseInt(strings.TrimSpace(q.Get("min_duration")), 10, 64); err == nil && n > 0 {
		f.MinDuration = n
	}
	return f
}

// parseOpenCookie reads the set of expanded disclosure ids. The value is URL
// encoded because ids contain characters (`:`) that a bare cookie value may
// not carry, and because the list is comma separated.
func parseOpenCookie(r *http.Request) map[string]bool {
	open := map[string]bool{}
	cookie, err := r.Cookie(cookieOpen)
	if err != nil {
		return open
	}
	decoded, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		return open
	}
	for _, id := range strings.Split(decoded, ",") {
		if id = strings.TrimSpace(id); id != "" {
			open[id] = true
		}
	}
	return open
}

// maxOpenIDs caps the cookie so a long session of clicking cannot grow it past
// what browsers will store (~4KB) and silently start dropping state.
const maxOpenIDs = 200

func writeOpenCookie(w http.ResponseWriter, open map[string]bool) {
	ids := make([]string, 0, len(open))
	for id, isOpen := range open {
		if isOpen {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) > maxOpenIDs {
		ids = ids[len(ids)-maxOpenIDs:]
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieOpen,
		Value:    url.QueryEscape(strings.Join(ids, ",")),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
	})
}

// parseTimezoneCookie resolves the viewer's zone, falling back to UTC. tzdata
// is embedded in main.go, so LoadLocation works on the alpine runtime image.
func parseTimezoneCookie(r *http.Request) *time.Location {
	cookie, err := r.Cookie(cookieTZ)
	if err != nil {
		return time.UTC
	}
	name, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

// ---------- Data loading ----------

// loadFeed is the all-sessions feed and the source the sidebar aggregates.
func (s *server) loadFeed(ctx context.Context) ([]eventSummary, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM claude_hooks
		ORDER BY event_time DESC
		LIMIT %d
		FORMAT JSONEachRow
	`, hookRowProjection, hookFeedLimit)
	events, err := s.loadEvents(ctx, query, nil)
	if err != nil {
		return nil, err
	}
	return buildSummaries(events), nil
}

// loadSession returns one session's raw events alongside the grouped timeline.
// Both are needed: the groups drive the rows, and the raw payloads carry the
// session-level fields (system_prompt, cwd) that eventSummary drops.
func (s *server) loadSession(ctx context.Context, sessionID string) ([]*hookEvent, timelineResponse, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM claude_hooks
		WHERE session_id = {session_id:String}
		ORDER BY event_time ASC
		LIMIT 5000
		FORMAT JSONEachRow
	`, hookRowProjection)
	params := url.Values{"param_session_id": []string{sessionID}}
	events, err := s.loadEvents(ctx, query, params)
	if err != nil {
		return nil, timelineResponse{}, err
	}
	summaries := buildSummaries(events)
	return events, buildTimeline(summaries), nil
}

// buildTotals is the "All sessions" pseudo-row at the top of the sidebar.
func buildTotals(sessions []sidebarSession) sidebarSession {
	totals := sidebarSession{ID: allSessionsID, Name: "All sessions"}
	for _, session := range sessions {
		totals.Count += session.Count
		totals.Tools += session.Tools
		totals.Failures += session.Failures
		if session.LastEvent > totals.LastEvent {
			totals.LastEvent = session.LastEvent
		}
	}
	return totals
}

// ---------- Fragment assembly ----------

// timelineBody builds the fragment that lives in #timeline-region: for a
// single session the replayer plus the rows it reveals, for the combined feed
// just the flat list. The replayer is session-scoped by design -- stepping
// through interleaved sessions has no meaning.
func timelineBody(rc renderContext, events []*hookEvent, summaries []eventSummary, tl timelineResponse) (templ.Component, string) {
	if rc.SelectedSession == allSessionsID {
		return FlatList(rc, groupBySession(rc.Filters.Apply(summaries))), canonicalPageURL(rc, -1)
	}
	groups := groupTurnsByUserMessage(tl.Turns)
	groups, matched := applyFiltersToGroups(groups, rc.Filters)

	total := len(replayOrder(groups))
	cursor := total
	if rc.CursorSet {
		cursor = clampCursor(rc.Cursor, total)
	}
	revealed := truncateToCursor(groups, cursor)

	usage := buildUsageBreakdown(events, flattenRows(revealed))
	body := templ.Join(
		ReplayBar(rc, cursor, total, usage),
		Timeline(rc, revealed, matched),
	)
	// The pushed step is the clamped one. Pushing the requested value would
	// put an out-of-range step in the address bar, which then survives a
	// reload and has to be clamped all over again.
	step := -1
	if rc.CursorSet {
		step = cursor
	}
	return body, canonicalPageURL(rc, step)
}

// canonicalPageURL is the address bar equivalent of a fragment request: the
// page that renders the same view on a cold load. The controls cannot carry it
// as a literal hx-push-url -- the scrubber's step is only known once the user
// drags it -- so handlers return it in the HX-Push-Url response header, which
// htmx honours over the attribute.
//
// Without this, htmx would push the /ui/timeline URL it actually requested,
// and reloading would hand the browser a bare fragment instead of the app.
func canonicalPageURL(rc renderContext, step int) string {
	q := url.Values{}
	q.Set("session", rc.SelectedSession)
	if step >= 0 {
		q.Set("step", itoa(step))
	}
	if rc.Filters.Failures {
		q.Set("failures", "1")
	}
	for key, value := range map[string]string{
		"kind": rc.Filters.Kind,
		"tool": rc.Filters.Tool,
		"file": rc.Filters.File,
	} {
		if value != "" {
			q.Set(key, value)
		}
	}
	if rc.Filters.MinDuration > 0 {
		q.Set("min_duration", strconv.FormatInt(rc.Filters.MinDuration, 10))
	}
	return "/?" + q.Encode()
}

// ---------- Handlers ----------

func (s *server) handleUIRoute(w http.ResponseWriter, r *http.Request) {
	switch strings.TrimPrefix(r.URL.Path, "/ui/") {
	case "main":
		s.handleUIMain(w, r)
	case "sessions":
		s.handleUISessions(w, r)
	case "timeline":
		s.handleUITimeline(w, r)
	case "groups/toggle":
		s.handleUIToggle(w, r, toggleGroup)
	case "rows/toggle":
		s.handleUIToggle(w, r, toggleRow)
	case "raw":
		s.handleUIRaw(w, r)
	default:
		http.NotFound(w, r)
	}
}

// renderFragment writes one component as an HTML fragment. htmx swaps the
// response body verbatim, so errors have to render as markup too -- a JSON
// error object would be injected into the page as text.
func renderFragment(w http.ResponseWriter, r *http.Request, component templ.Component) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	if err := component.Render(r.Context(), w); err != nil {
		log.Printf("render: %v", err)
	}
}

func renderError(w http.ResponseWriter, r *http.Request, err error) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = ErrorBlock(err.Error()).Render(r.Context(), w)
}

func (s *server) handleUIMain(w http.ResponseWriter, r *http.Request) {
	rc := parseRenderContext(r)
	page, err := s.buildPage(r, rc)
	if err != nil {
		renderError(w, r, err)
		return
	}
	renderFragment(w, r, page)
}

// buildPage assembles the whole two-panel body, which both "/" and /ui/main
// need -- the first wrapped in Layout, the second on its own.
func (s *server) buildPage(r *http.Request, rc renderContext) (templ.Component, error) {
	feed, err := s.loadFeed(r.Context())
	if err != nil {
		return nil, err
	}
	sessions := buildSessions(feed)
	totals := buildTotals(sessions)

	var (
		events    []*hookEvent
		summaries = feed
		tl        timelineResponse
		session   *sessionSummary
		title     = "All sessions"
	)
	if rc.SelectedSession != allSessionsID {
		events, tl, err = s.loadSession(r.Context(), rc.SelectedSession)
		if err != nil {
			return nil, err
		}
		summaries = flattenTimeline(tl)
		session = &tl.Session
		title = tl.Session.Name
	}

	tools := toolNames(summaries)
	rc.Filters.Tool = resolveToolFilter(rc.Filters.Tool, tools)

	body, _ := timelineBody(rc, events, summaries, tl)
	return Page(rc, sessions, totals, EventsPanel(rc, title, session, tools, body)), nil
}

func (s *server) handleUISessions(w http.ResponseWriter, r *http.Request) {
	rc := parseRenderContext(r)
	feed, err := s.loadFeed(r.Context())
	if err != nil {
		renderError(w, r, err)
		return
	}
	sessions := buildSessions(feed)
	renderFragment(w, r, Sidebar(rc, sessions, buildTotals(sessions)))
}

func (s *server) handleUITimeline(w http.ResponseWriter, r *http.Request) {
	rc := parseRenderContext(r)
	body, pushURL, err := s.buildTimelineBody(r, rc)
	if err != nil {
		renderError(w, r, err)
		return
	}
	w.Header().Set("HX-Push-Url", pushURL)
	renderFragment(w, r, body)
}

func (s *server) buildTimelineBody(r *http.Request, rc renderContext) (templ.Component, string, error) {
	if rc.SelectedSession == allSessionsID {
		feed, err := s.loadFeed(r.Context())
		if err != nil {
			return nil, "", err
		}
		body, pushURL := timelineBody(rc, nil, feed, timelineResponse{})
		return body, pushURL, nil
	}
	events, tl, err := s.loadSession(r.Context(), rc.SelectedSession)
	if err != nil {
		return nil, "", err
	}
	body, pushURL := timelineBody(rc, events, flattenTimeline(tl), tl)
	return body, pushURL, nil
}

// toggleTarget names which fragment a toggle re-renders.
type toggleTarget int

const (
	toggleGroup toggleTarget = iota
	toggleRow
)

// handleUIToggle flips one disclosure in the cookie and re-renders just that
// fragment. The cookie is written before rendering because headers cannot be
// set once the body has started.
func (s *server) handleUIToggle(w http.ResponseWriter, r *http.Request, target toggleTarget) {
	if r.Method != http.MethodPost {
		w.Header().Set("allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rc := parseRenderContext(r)
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.NotFound(w, r)
		return
	}
	rc.Open[id] = !rc.Open[id]
	writeOpenCookie(w, rc.Open)

	if target == toggleRow {
		ev, err := s.findEvent(r, rc, id)
		if err != nil {
			renderError(w, r, err)
			return
		}
		if ev == nil {
			http.NotFound(w, r)
			return
		}
		renderFragment(w, r, Row(rc, *ev))
		return
	}

	_, tl, err := s.loadSession(r.Context(), rc.SelectedSession)
	if err != nil {
		renderError(w, r, err)
		return
	}
	groups, matched := applyFiltersToGroups(groupTurnsByUserMessage(tl.Turns), rc.Filters)
	for _, group := range groups {
		if group.ID == id {
			renderFragment(w, r, UserMsgGroup(rc, group, groupIsOpen(rc, group, matched)))
			return
		}
	}
	http.NotFound(w, r)
}

// findEvent locates one row in whichever view is selected.
func (s *server) findEvent(r *http.Request, rc renderContext, eventID string) (*eventSummary, error) {
	var (
		summaries []eventSummary
		err       error
	)
	if rc.SelectedSession == allSessionsID {
		summaries, err = s.loadFeed(r.Context())
	} else {
		var tl timelineResponse
		_, tl, err = s.loadSession(r.Context(), rc.SelectedSession)
		summaries = flattenTimeline(tl)
	}
	if err != nil {
		return nil, err
	}
	for i := range summaries {
		if summaries[i].EventID == eventID {
			return &summaries[i], nil
		}
	}
	return nil, nil
}

func (s *server) handleUIRaw(w http.ResponseWriter, r *http.Request) {
	eventID := strings.TrimSpace(r.URL.Query().Get("id"))
	if eventID == "" {
		renderFragment(w, r, DrawerEmpty())
		return
	}
	term := strings.TrimSpace(r.URL.Query().Get("q"))
	query := fmt.Sprintf(`
		SELECT %s
		FROM claude_hooks
		WHERE event_id = {event_id:String}
		   OR event_natural_id = {event_id:String}
		LIMIT 1
		FORMAT JSONEachRow
	`, hookRowProjection)
	events, err := s.loadEvents(r.Context(), query, url.Values{"param_event_id": []string{eventID}})
	if err != nil {
		renderError(w, r, err)
		return
	}
	if len(events) == 0 {
		renderFragment(w, r, DrawerEmpty())
		return
	}
	event := events[0]
	raw, err := json.Marshal(event.Payload)
	if err != nil {
		renderError(w, r, err)
		return
	}
	node, err := parseJSONNode(raw)
	if err != nil {
		renderError(w, r, err)
		return
	}
	renderFragment(w, r, DrawerContent(eventID, event.EventName, event.SessionID, term, node))
}

// flattenTimeline is the timeline's rows as a flat list, for the filter
// dropdown and row lookups. Notes are included so a row that the timeline
// does not draw can still be opened from the drawer.
func flattenTimeline(tl timelineResponse) []eventSummary {
	var out []eventSummary
	for _, t := range tl.Turns {
		if t.Prompt != nil {
			out = append(out, *t.Prompt)
		}
		out = append(out, t.Tools...)
		out = append(out, t.Notes...)
		if t.Response != nil {
			out = append(out, *t.Response)
		}
	}
	return out
}
