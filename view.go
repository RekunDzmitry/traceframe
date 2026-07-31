package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// This file ports the display logic that used to run in the browser
// (static/index.html) so templates can consume it directly. Everything here is
// pure: no I/O, no globals, no request scope -- which is what makes it
// testable, unlike the JS it replaces.

// ---------- Render context ----------

// renderContext carries the per-request state every component needs: which
// session is selected, what is filtered, which disclosures are open, and the
// viewer's timezone. It replaces the module-level `state` object the JS kept.
type renderContext struct {
	SelectedSession string
	Filters         timelineFilters
	Open            map[string]bool
	Loc             *time.Location

	// Cursor is the history replayer's position: how many rows of the
	// session are revealed. CursorSet distinguishes "replay to step 0"
	// (show nothing) from "no step parameter" (show everything), which a
	// bare int cannot.
	Cursor    int
	CursorSet bool
}

func (c renderContext) IsOpen(id string) bool { return c.Open[id] }

// FormatTime renders a stored RFC3339 timestamp in the viewer's zone. The JS
// used Intl with an undefined locale, i.e. the browser's; the zone now arrives
// from a cookie instead, with UTC as the fallback until it is set.
func (c renderContext) FormatTime(value string) string {
	if value == "" {
		return ""
	}
	at, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return value
	}
	loc := c.Loc
	if loc == nil {
		loc = time.UTC
	}
	return at.In(loc).Format("Jan 2, 03:04:05 PM")
}

// formatDuration renders a millisecond span for the session stats bar.
func formatDuration(ms int64) string {
	if ms <= 0 {
		return "—"
	}
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	s := float64(ms) / 1000
	if s < 60 {
		return fmt.Sprintf("%.1fs", s)
	}
	return fmt.Sprintf("%dm %ds", int(s)/60, int(s)%60)
}

// ---------- Sidebar ----------

// sidebarSession is one row of the session list, aggregated from the flat hook
// feed rather than the per-session timeline.
type sidebarSession struct {
	ID        string
	Name      string
	Count     int
	Tools     int
	Failures  int
	LastEvent string
}

// Meta is the "12 events · 3 tools · 1 failure" line.
func (s sidebarSession) Meta() string {
	parts := []string{plural(s.Count, "event")}
	if s.Tools > 0 {
		parts = append(parts, plural(s.Tools, "tool"))
	}
	if s.Failures > 0 {
		parts = append(parts, plural(s.Failures, "failure"))
	}
	return strings.Join(parts, " · ")
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// buildSessions aggregates the flat hook list into sidebar rows, newest first.
func buildSessions(hooks []eventSummary) []sidebarSession {
	order := []string{}
	byID := map[string]*sidebarSession{}
	for _, h := range hooks {
		id := h.SessionID
		if id == "" {
			id = "unknown"
		}
		existing, ok := byID[id]
		if !ok {
			name := h.SessionName
			if name == "" {
				name = id
				if id == "unknown" {
					name = "Unknown session"
				}
			}
			existing = &sidebarSession{ID: id, Name: name, LastEvent: h.EventTime}
			byID[id] = existing
			order = append(order, id)
		}
		existing.Count++
		if h.Kind == kindTool {
			existing.Tools++
		}
		if h.Status == statusError {
			existing.Failures++
		}
		if h.EventTime > existing.LastEvent {
			existing.LastEvent = h.EventTime
		}
	}
	sessions := make([]sidebarSession, 0, len(order))
	for _, id := range order {
		sessions = append(sessions, *byID[id])
	}
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].LastEvent > sessions[j].LastEvent
	})
	return sessions
}

// ---------- User-message grouping ----------

// injectedPromptPrefixes marks UserPromptSubmit events that nobody typed.
// Agents fire the same hook for machine-generated content -- background-agent
// reports, system reminders, the output of `!` shell commands -- so those must
// not head a group; they belong to the message whose work they are part of.
// The host prepends a wrapper tag, which is what we match.
var injectedPromptPrefixes = []string{
	"<task-notification>",
	"<system-reminder>",
	"<local-command-caveat>",
	"<command-name>",
	"<command-message>",
	"<bash-input>",
	"<bash-stdout>",
	"<bash-stderr>",
}

// supersededPromptWindow is how long after a prompt a longer re-submission
// still counts as the same message being completed rather than a new one.
const supersededPromptWindow = 2 * time.Minute

// userMessageGroup is one message the user actually typed, together with every
// turn the agent produced before the next one. The server closes a turn on
// every Stop, so a single message routinely spans several turns.
type userMessageGroup struct {
	ID        string
	Prompt    *eventSummary
	Turns     []turn
	ToolCount int
}

// StartedAt is the start of the group's first turn, used for the header.
func (g userMessageGroup) StartedAt() string {
	if len(g.Turns) == 0 {
		return ""
	}
	return g.Turns[0].StartedAt
}

func isInjectedPrompt(prompt *eventSummary) bool {
	if prompt == nil {
		return false
	}
	text := strings.TrimLeft(prompt.Content, " \t\r\n")
	for _, tag := range injectedPromptPrefixes {
		if strings.HasPrefix(text, tag) {
			return true
		}
	}
	return false
}

// supersededBy reports whether a is a fragment that b completed: the user
// submitted, kept typing, and the host re-sent the whole message. The earlier
// row is then a strict prefix of the later one, arrived moments before it, and
// never got far enough to run a tool. That last condition is the strong one --
// a message that did work was clearly not abandoned mid-typing.
func supersededBy(a, b userMessageGroup) bool {
	if a.Prompt == nil || b.Prompt == nil || a.ToolCount != 0 {
		return false
	}
	at, bt := a.Prompt.Content, b.Prompt.Content
	if at == "" || len(at) >= len(bt) || !strings.HasPrefix(bt, at) {
		return false
	}
	aAt, err := time.Parse(time.RFC3339Nano, a.Prompt.EventTime)
	if err != nil {
		return false
	}
	bAt, err := time.Parse(time.RFC3339Nano, b.Prompt.EventTime)
	if err != nil {
		return false
	}
	gap := bAt.Sub(aAt)
	return gap >= 0 && gap <= supersededPromptWindow
}

// groupTurnsByUserMessage groups the timeline's turns by the message that
// started them. A turn carries a Prompt exactly when a UserPromptSubmit opened
// it, which makes it the group boundary. Turns arriving before any prompt (the
// server synthesises a prompt-less turn for those) collect into one leading
// group.
//
// Group ids are keyed on the prompt's event_id so they stay stable across the
// refresh -- the cookie that records which groups are open depends on that.
// The separator is a hyphen, not a colon: the id goes into an hx-target as
// `#<id>`, and a colon there makes an invalid CSS selector, so htmx silently
// finds no element and the disclosure never toggles.
func groupTurnsByUserMessage(turns []turn) []userMessageGroup {
	var groups []userMessageGroup
	current := -1
	for _, t := range turns {
		startsGroup := t.Prompt != nil && !isInjectedPrompt(t.Prompt)
		if startsGroup || current < 0 {
			group := userMessageGroup{ID: "ug-orphan"}
			if startsGroup {
				group.ID = "ug-" + t.Prompt.EventID
				group.Prompt = t.Prompt
			}
			groups = append(groups, group)
			current = len(groups) - 1
		}
		groups[current].Turns = append(groups[current].Turns, t)
		groups[current].ToolCount += len(t.Tools)
	}
	// Fold superseded fragments forward into the completed message. Walk
	// backwards so a chain of edits collapses into the final submission.
	for i := len(groups) - 2; i >= 0; i-- {
		if !supersededBy(groups[i], groups[i+1]) {
			continue
		}
		groups[i+1].Turns = append(append([]turn{}, groups[i].Turns...), groups[i+1].Turns...)
		groups[i+1].ToolCount += groups[i].ToolCount
		groups = append(groups[:i], groups[i+1:]...)
	}
	return groups
}

// ---------- Filters ----------

// timelineFilters mirrors the five filter controls. It arrives from query
// parameters rather than DOM reads now, so a filtered view is shareable.
type timelineFilters struct {
	Failures    bool
	Kind        string
	Tool        string
	MinDuration int64
	File        string // already lowercased
}

// Active reports whether anything is narrowing the view. Collapsed groups hide
// the per-row dimming, so the renderer force-opens matching groups when this is
// true.
func (f timelineFilters) Active() bool {
	return f.Failures || f.Kind != "" || f.Tool != "" || f.MinDuration > 0 || f.File != ""
}

// Apply keeps the events that pass every active filter.
func (f timelineFilters) Apply(events []eventSummary) []eventSummary {
	out := make([]eventSummary, 0, len(events))
	for _, ev := range events {
		if f.Failures && ev.Status != statusError {
			continue
		}
		if f.Kind != "" && ev.Kind != f.Kind {
			continue
		}
		if f.Tool != "" && ev.ToolName != f.Tool {
			continue
		}
		// Min duration applies to tool events only. Prompts, responses and
		// other rows carry no duration, so filtering them on it would
		// silently drop every one of them.
		if f.MinDuration > 0 && ev.Kind == kindTool {
			var d int64
			if ev.DurationMS != nil {
				d = *ev.DurationMS
			}
			if d < f.MinDuration {
				continue
			}
		}
		if f.File != "" && !strings.Contains(strings.ToLower(eventFilePath(ev)), f.File) {
			continue
		}
		out = append(out, ev)
	}
	return out
}

// eventFilePath is the path the file filter matches against: the tool input's
// file_path, falling back to the output's filePath.
func eventFilePath(ev eventSummary) string {
	if v, ok := ev.Input["file_path"].(string); ok && v != "" {
		return v
	}
	if v, ok := ev.Output["filePath"].(string); ok {
		return v
	}
	return ""
}

// toolNames lists the distinct tool names present, sorted, for the dropdown.
func toolNames(events []eventSummary) []string {
	seen := make(map[string]struct{})
	for _, ev := range events {
		if ev.ToolName != "" {
			seen[ev.ToolName] = struct{}{}
		}
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// resolveToolFilter drops a selected tool that is no longer present in the
// data. Without this the view silently empties out: the dropdown shows a tool
// that nothing matches, and every row is filtered away with no way to tell why.
func resolveToolFilter(selected string, available []string) string {
	if selected == "" {
		return ""
	}
	for _, name := range available {
		if name == selected {
			return selected
		}
	}
	return ""
}

// ---------- Row presentation ----------

type chip struct {
	Text string
	Tone string // "" | "error" | "warning"
}

func summaryFor(ev eventSummary) string {
	switch ev.Kind {
	case kindTool:
		if ev.Summary != "" {
			return ev.Summary
		}
		if ev.ToolName != "" {
			return ev.ToolName
		}
		return "Tool"
	case kindUserPrompt:
		if ev.Content == "" {
			return "(empty prompt)"
		}
		return truncateRunes(firstLine(ev.Content), 160)
	case kindAssistantStop:
		return "response complete"
	case kindSessionStart:
		return "session started"
	case kindSessionEnd:
		return "session ended"
	case kindNotification:
		return firstNonEmpty(ev.Content, ev.Summary, "notification")
	case kindPermissionReq:
		if ev.ToolName != "" {
			return "request permission for " + ev.ToolName
		}
		return "permission request"
	case kindCompact:
		return "compact context"
	default:
		return firstNonEmpty(ev.Summary, ev.EventName, "event")
	}
}

func chipsFor(ev eventSummary) []chip {
	if ev.Kind != kindTool {
		return nil
	}
	var chips []chip
	switch ev.Status {
	case statusOK:
		chips = append(chips, chip{Text: "ok"})
	case statusError:
		chips = append(chips, chip{Text: "error: " + firstNonEmpty(ev.Error, "failed"), Tone: "error"})
	case statusPending:
		chips = append(chips, chip{Text: "pending", Tone: "warning"})
	}
	if ev.PermissionMode != "" {
		chips = append(chips, chip{Text: ev.PermissionMode})
	}
	if ev.Effort != "" {
		chips = append(chips, chip{Text: "effort: " + ev.Effort})
	}
	return chips
}

func iconFor(ev eventSummary) string {
	if ev.Kind != kindTool {
		return "·"
	}
	switch ev.Status {
	case statusError:
		return "!"
	case statusPending:
		return "…"
	}
	return "✓"
}

func durationFor(ev eventSummary) string {
	if ev.Kind != kindTool || ev.DurationMS == nil {
		return ""
	}
	ms := *ev.DurationMS
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	return fmt.Sprintf("%.2fs", float64(ms)/1000)
}

func humanKind(kind string) string {
	if kind == "" {
		return "event"
	}
	return strings.ReplaceAll(kind, "_", " ")
}

// truncateRunes cuts on rune boundaries. The existing byte-based truncate is
// right for capping payload sizes, but slicing bytes for display can split a
// multibyte character and emit a replacement glyph.
func truncateRunes(s string, max int) string {
	if max <= 0 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
