package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Helpers the templates call. Kept in Go rather than inline in .templ files so
// they stay unit-testable.

func boolAttr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// itoa exists because templ renders numbers in text but not in attribute
// values, and the replayer needs the cursor in both places.
func itoa(n int) string { return strconv.Itoa(n) }

// formatPct renders a share of the context window. Anything under a tenth of a
// percent shows as "0.0%" rather than rounding up to a number that overstates
// a category the user cannot see.
func formatPct(v float64) string {
	return fmt.Sprintf("%.1f%%", v)
}

// ---------- Replayer links ----------

// replayURL is the endpoint the scrubber posts to. It carries no step of its
// own -- the range input supplies one from its own value.
func replayURL(ctx renderContext) string {
	return "/ui/timeline?session=" + url.QueryEscape(ctx.SelectedSession)
}

// replayStepURL pins a specific step, for the four transport buttons.
func replayStepURL(ctx renderContext, step int) string {
	if step < 0 {
		step = 0
	}
	return replayURL(ctx) + "&step=" + itoa(step)
}

// ---------- Groups ----------

func groupTitle(group userMessageGroup) string {
	if group.Prompt == nil {
		return "Before first prompt"
	}
	if title := truncateRunes(firstLine(group.Prompt.Content), 120); title != "" {
		return title
	}
	return "(empty prompt)"
}

// groupIsOpen decides whether a group renders expanded. A filter force-opens
// groups holding a match, because a dimmed row is invisible inside a collapsed
// group. That override is deliberately not written back to the cookie, so
// clearing the filter restores exactly what the user opened by hand.
func groupIsOpen(ctx renderContext, group userMessageGroup, matched map[string]bool) bool {
	if ctx.IsOpen(group.ID) {
		return true
	}
	if !ctx.Filters.Active() {
		return false
	}
	for _, t := range group.Turns {
		for _, tool := range t.Tools {
			if matched[tool.EventID] {
				return true
			}
		}
	}
	return false
}

func responseText(response *eventSummary) string {
	if response == nil {
		return ""
	}
	if response.Content != "" {
		return response.Content
	}
	return "_(response recorded; click View raw for the payload)_"
}

// flatSessionGroup is one session's events in the all-sessions view.
type flatSessionGroup struct {
	ID        string
	Name      string
	LastEvent string
	Events    []eventSummary
}

// groupBySession buckets the flat feed by session, preserving the order the
// events arrived in.
func groupBySession(events []eventSummary) []flatSessionGroup {
	var order []string
	byID := map[string]*flatSessionGroup{}
	for _, ev := range events {
		group, ok := byID[ev.SessionID]
		if !ok {
			name := ev.SessionName
			if name == "" {
				name = shortID(ev.SessionID)
			}
			group = &flatSessionGroup{ID: ev.SessionID, Name: name, LastEvent: ev.EventTime}
			byID[ev.SessionID] = group
			order = append(order, ev.SessionID)
		}
		if ev.EventTime > group.LastEvent {
			group.LastEvent = ev.EventTime
		}
		group.Events = append(group.Events, ev)
	}
	groups := make([]flatSessionGroup, 0, len(order))
	for _, id := range order {
		groups = append(groups, *byID[id])
	}
	return groups
}

// ---------- Rows ----------

func rowStatusClass(ev eventSummary) string {
	if ev.Kind != kindTool {
		return ""
	}
	if ev.Status == "" {
		return statusOK
	}
	return ev.Status
}

func rowTag(ev eventSummary) string {
	switch {
	case ev.Kind == kindTool && ev.ToolName != "":
		return ev.ToolName
	case ev.Kind == kindUserPrompt:
		return "You"
	case ev.Kind == kindAssistantStop:
		return "Assistant"
	}
	return humanKind(ev.Kind)
}

// sortedKeys gives map iteration a stable order. The JS relied on JavaScript
// object insertion order; Go maps randomise, so without this the input and
// output tables would reshuffle on every render.
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func isPendingOutput(ev eventSummary) bool {
	pending, ok := ev.Output["pending"].(bool)
	return ok && pending
}

func inputCommand(ev eventSummary) string {
	if v := stringField(ev.Input, "command"); v != "" {
		return v
	}
	return stringField(ev.Input, "description")
}

func stringField(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

// intField reads a JSON number, which decodes as float64.
func intField(m map[string]any, key string) (string, bool) {
	switch v := m[key].(type) {
	case float64:
		return strconv.FormatInt(int64(v), 10), true
	case int64:
		return strconv.FormatInt(v, 10), true
	}
	return "", false
}

// readMeta is the "path · lines 4–12" line above a Read result. The off-by-one
// is the tool's own convention: startLine is zero-based, the display is not.
func readMeta(output map[string]any) string {
	var parts []string
	if p := stringField(output, "filePath"); p != "" {
		parts = append(parts, p)
	}
	start, startOK := output["startLine"].(float64)
	num, numOK := output["numLines"].(float64)
	if startOK && numOK {
		parts = append(parts, fmt.Sprintf("lines %d–%d", int(start)+1, int(start)+int(num)))
	}
	return strings.Join(parts, " · ")
}

// ---------- Diff ----------

type diffHunk struct {
	OldStart, OldLines int
	NewStart, NewLines int
	Lines              []string
}

func (h diffHunk) Header() string {
	return fmt.Sprintf("@@ -%d,%d +%d,%d @@", h.OldStart, h.OldLines, h.NewStart, h.NewLines)
}

func diffLineClass(line string) string {
	switch {
	case strings.HasPrefix(line, "+"):
		return "add"
	case strings.HasPrefix(line, "-"):
		return "remove"
	}
	return "context"
}

// structuredPatch pulls the Edit tool's hunks out of the untyped output map.
func structuredPatch(ev eventSummary) []diffHunk {
	raw, ok := ev.Output["structuredPatch"].([]any)
	if !ok {
		return nil
	}
	hunks := make([]diffHunk, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		hunk := diffHunk{
			OldStart: intOf(m["oldStart"]),
			OldLines: intOf(m["oldLines"]),
			NewStart: intOf(m["newStart"]),
			NewLines: intOf(m["newLines"]),
		}
		if lines, ok := m["lines"].([]any); ok {
			for _, l := range lines {
				if s, ok := l.(string); ok {
					hunk.Lines = append(hunk.Lines, s)
				}
			}
		}
		hunks = append(hunks, hunk)
	}
	return hunks
}

func intOf(v any) int {
	if f, ok := v.(float64); ok {
		return int(f)
	}
	return 0
}

// ---------- Values ----------

// formattedValue is how a single input/output value should render: as an
// inline span or as a pre block.
type formattedValue struct {
	Text  string
	Class string
	Block bool
}

// formatValue mirrors the JS dispatch: strings over 200 chars and any
// structure become a <pre>; short scalars stay inline.
func formatValue(value any) formattedValue {
	switch v := value.(type) {
	case nil:
		return formattedValue{Text: "null"}
	case string:
		if len(v) > 200 {
			return formattedValue{Text: v, Block: true}
		}
		encoded, err := json.Marshal(v)
		if err != nil {
			return formattedValue{Text: v, Class: "code-inline"}
		}
		return formattedValue{Text: string(encoded), Class: "code-inline"}
	case bool:
		return formattedValue{Text: strconv.FormatBool(v)}
	case float64:
		return formattedValue{Text: strconv.FormatFloat(v, 'f', -1, 64)}
	case []any:
		if len(v) == 0 {
			return formattedValue{Text: "[]"}
		}
		if scalars, ok := scalarBullets(v); ok {
			return formattedValue{Text: scalars, Block: true}
		}
		return formattedValue{Text: prettyJSON(v), Block: true}
	}
	return formattedValue{Text: prettyJSON(value), Block: true}
}

// scalarBullets renders an all-scalar array as a bullet list, as the JS did.
func scalarBullets(items []any) (string, bool) {
	var b strings.Builder
	for i, item := range items {
		var text string
		switch v := item.(type) {
		case string:
			text = v
		case float64:
			text = strconv.FormatFloat(v, 'f', -1, 64)
		default:
			return "", false
		}
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString("• " + text)
	}
	return b.String(), true
}

func prettyJSON(value any) string {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(encoded)
}
