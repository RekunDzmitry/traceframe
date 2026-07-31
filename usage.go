package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

// The usage panel answers "what is filling the context window right now",
// where "now" is wherever the history replayer is parked. It is the successor
// to the Context Usage Map deleted in 5807f93 (static/context.js), rebuilt
// server-side: the category attribution is a port of that file's builders,
// and the numbers it divides come from the context snapshots the backend
// already reads out of session transcripts (attachContextUsage).
//
// Two categories are new and have no hook behind them -- custom agents and
// memory files are loaded into the model's context by the host before any
// event is emitted, so the only way to size them is to read the files off
// disk. That is the one new filesystem surface here, and it is sandboxed the
// same way transcripts are (see allowedProjectFile).

type usageCategory struct {
	Name string
	// Icon is the leading glyph in the panel. Purely decorative -- the
	// name carries the meaning, so this stays out of the accessible text.
	Icon string
	// Tokens is the category's size. Estimated says whether it was
	// measured or approximated, which the panel shows rather than hides.
	Tokens    int64
	Estimated bool
	// Note explains a zero that is not really a zero, e.g. a provider that
	// does not report its system prompt.
	Note string
}

// Pct is the share of the context window, not of the used total: the panel
// sits next to "Free space", and percentages that do not add up with it would
// read as a bug.
func (c usageCategory) Pct(window int64) float64 {
	if window <= 0 {
		return 0
	}
	return float64(c.Tokens) / float64(window) * 100
}

type usageBreakdown struct {
	Model      string
	Window     int64
	Total      int64
	Categories []usageCategory
	// Measured is true when Total came from a real context snapshot rather
	// than from adding up estimates.
	Measured bool
}

// estimateTokens is the character heuristic the deleted tokenizer.js used as
// its own fallback (`ceil(len / 4)`). There is no tokenizer in-tree -- the old
// one lazy-loaded a real BPE from a CDN, which a server-rendered panel cannot
// do -- so every category built from text is explicitly flagged as estimated.
func estimateTokens(s string) int64 {
	if s == "" {
		return 0
	}
	return int64((utf8.RuneCountInString(s) + 3) / 4)
}

// formatTokens shortens counts for the panel: 4200 -> "4.2k", 1_200_000 -> "1.2M".
// Ported from static/context.js formatTokens.
func formatTokens(n int64) string {
	switch {
	case n >= 1_000_000:
		return trimZero(fmt.Sprintf("%.1f", float64(n)/1_000_000)) + "M"
	case n >= 1_000:
		return trimZero(fmt.Sprintf("%.1f", float64(n)/1_000)) + "k"
	default:
		return fmt.Sprintf("%d", n)
	}
}

func trimZero(s string) string {
	return strings.TrimSuffix(s, ".0")
}

// ---------- Breakdown ----------

// buildUsageBreakdown sizes the context at one replayer position.
//
// events is the raw hook feed, needed for session-level payload fields that
// eventSummary drops (system_prompt, system_tools, cwd). revealed is only the
// rows the replayer has uncovered, which is what makes the panel move as you
// scrub: messages, observed tools and invoked skills all grow with it.
func buildUsageBreakdown(events []*hookEvent, revealed []eventSummary) usageBreakdown {
	out := usageBreakdown{}

	// Window and the true total come from the context snapshots already
	// attached to rows. Walking backwards finds the most recent revealed
	// measurement, i.e. the context size at the cursor.
	for i := len(revealed) - 1; i >= 0; i-- {
		ev := revealed[i]
		if out.Model == "" && ev.Model != "" {
			out.Model = ev.Model
		}
		if out.Window == 0 && ev.ContextWindow > 0 {
			out.Window = ev.ContextWindow
		}
		if !out.Measured && ev.ContextTokens > 0 {
			out.Total = ev.ContextTokens
			out.Measured = true
		}
		if out.Model != "" && out.Window > 0 && out.Measured {
			break
		}
	}
	if out.Model == "" {
		out.Model = sessionModel(events)
	}
	if out.Window == 0 {
		out.Window = claudeContextWindow(out.Model)
	}

	root := sessionProjectRoot(events)
	systemPrompt := systemPromptCategory(events)
	systemTools := systemToolsCategory(events, revealed)
	agents := customAgentsCategory(root)
	memory := memoryFilesCategory(root)
	skills := skillsCategory(revealed)
	messages := messagesCategory(revealed)

	fixed := []usageCategory{systemPrompt, systemTools, agents, memory, skills}

	// With a real total available, messages is the residual rather than an
	// estimate: everything else is small and separately measured, and the
	// bulk is exactly what a character heuristic gets most wrong.
	if out.Measured {
		var others int64
		for _, c := range fixed {
			others += c.Tokens
		}
		if remainder := out.Total - others; remainder > 0 {
			messages.Tokens = remainder
			messages.Estimated = false
		}
	} else {
		for _, c := range fixed {
			out.Total += c.Tokens
		}
		out.Total += messages.Tokens
	}

	free := usageCategory{Name: "Free space", Icon: "▫"}
	if remaining := out.Window - out.Total; remaining > 0 {
		free.Tokens = remaining
	}

	out.Categories = append(fixed, messages, free)
	return out
}

func sessionModel(events []*hookEvent) string {
	for i := len(events) - 1; i >= 0; i-- {
		if m := stringFromPayload(events[i].Payload, "model"); m != "" {
			return m
		}
	}
	return ""
}

// sessionProjectRoot is the working directory the agent reported. Hook
// payloads carry it on most events; the first one that has it wins.
func sessionProjectRoot(events []*hookEvent) string {
	for _, e := range events {
		if cwd := firstString(e.Payload, "cwd", "workspace", "repository", "repo"); cwd != "" {
			return cwd
		}
	}
	return ""
}

// systemPromptCategory reads SessionStart's system_prompt. Most providers do
// not send it; saying so beats printing a confident 0.
func systemPromptCategory(events []*hookEvent) usageCategory {
	c := usageCategory{Name: "System prompt", Icon: "▤"}
	for _, e := range events {
		if classifyEvent(e.EventName) != kindSessionStart {
			continue
		}
		if prompt := stringFromPayload(e.Payload, "system_prompt"); prompt != "" {
			c.Tokens = estimateTokens(prompt)
			c.Estimated = true
			return c
		}
	}
	c.Note = "not captured by this provider's hook"
	return c
}

// systemToolsCategory prefers the tool list SessionStart declared. Absent
// that, every tool actually called is a tool the model was told about, so the
// observed set is a floor -- flagged as inferred, as the JS did.
func systemToolsCategory(events []*hookEvent, revealed []eventSummary) usageCategory {
	c := usageCategory{Name: "System tools", Icon: "▥", Estimated: true}
	var text strings.Builder
	declared := 0
	for _, e := range events {
		if classifyEvent(e.EventName) != kindSessionStart {
			continue
		}
		list, ok := e.Payload["system_tools"].([]any)
		if !ok {
			continue
		}
		for _, item := range list {
			tool, ok := item.(map[string]any)
			if !ok {
				continue
			}
			name, _ := tool["name"].(string)
			if name == "" {
				continue
			}
			declared++
			text.WriteString(name)
			if desc, ok := tool["description"].(string); ok {
				text.WriteString(desc)
			}
		}
	}
	if declared == 0 {
		for _, name := range toolNames(revealed) {
			text.WriteString(name)
		}
		c.Note = "inferred from observed tool calls"
	}
	c.Tokens = estimateTokens(text.String())
	return c
}

// skillNames are the tools that pull a skill's instructions into context.
var skillToolNames = map[string]bool{"Skill": true, "SlashCommand": true, "SkillTool": true}

func skillsCategory(revealed []eventSummary) usageCategory {
	c := usageCategory{Name: "Skills", Icon: "▦", Estimated: true}
	seen := map[string]bool{}
	var text strings.Builder
	for _, ev := range revealed {
		if ev.Kind != kindTool || !skillToolNames[ev.ToolName] {
			continue
		}
		name := firstStringField(ev.Input, "name", "skill", "command")
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		text.WriteString(name)
		text.WriteString(ev.Summary)
	}
	c.Tokens = estimateTokens(text.String())
	return c
}

// messagesCategory is the conversation itself: what the user typed and what
// the agent said back, plus the tool traffic in between. This is the category
// that visibly grows while scrubbing.
func messagesCategory(revealed []eventSummary) usageCategory {
	c := usageCategory{Name: "Messages", Icon: "▧", Estimated: true}
	var total int64
	for _, ev := range revealed {
		total += estimateTokens(ev.Content)
		total += estimateTokens(ev.Summary)
	}
	c.Tokens = total
	return c
}

// ---------- Files on disk ----------

// customAgentsCategory sizes the agent definitions the host injects. These are
// static for the session -- they are loaded before the first event -- so
// unlike skills they do not grow with the cursor.
func customAgentsCategory(projectRoot string) usageCategory {
	c := usageCategory{Name: "Custom agents", Icon: "▨", Estimated: true}
	dirs := []string{}
	if projectRoot != "" {
		dirs = append(dirs, filepath.Join(projectRoot, ".claude", "agents"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".claude", "agents"))
	}
	seen := map[string]bool{}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
				continue
			}
			names = append(names, entry.Name())
		}
		// ReadDir is already sorted, but the agent set is keyed by name
		// across two roots: a project agent shadows a user one.
		sort.Strings(names)
		for _, name := range names {
			if seen[name] {
				continue
			}
			seen[name] = true
			c.Tokens += readFileTokens(filepath.Join(dir, name))
		}
	}
	if len(seen) == 0 {
		c.Note = "none found"
	}
	return c
}

// memoryFilesCategory sizes the CLAUDE.md / MEMORY.md files the host prepends.
func memoryFilesCategory(projectRoot string) usageCategory {
	c := usageCategory{Name: "Memory files", Icon: "▩", Estimated: true}
	var paths []string
	if projectRoot != "" {
		paths = append(paths,
			filepath.Join(projectRoot, "CLAUDE.md"),
			filepath.Join(projectRoot, "MEMORY.md"),
			filepath.Join(projectRoot, ".claude", "CLAUDE.md"),
		)
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths,
			filepath.Join(home, ".claude", "CLAUDE.md"),
			filepath.Join(home, ".claude", "MEMORY.md"),
		)
	}
	found := false
	for _, path := range paths {
		if tokens := memoryFileTokens(path); tokens > 0 {
			c.Tokens += tokens
			found = true
		}
	}
	if !found {
		c.Note = "none found"
	}
	return c
}

// memoryFileTokens sizes one memory file plus the files it pulls in with an
// `@path` line on its own. Those imports are the whole point of the category
// being accurate: a CLAUDE.md whose entire body is `@RTK.md` costs two tokens
// by itself and whatever RTK.md costs in practice.
//
// Imports are followed exactly one level. Deeper nesting is rare, and a depth
// limit is cheaper to reason about than cycle detection.
func memoryFileTokens(rawPath string) int64 {
	body, path, ok := readContextFile(rawPath)
	if !ok {
		return 0
	}
	total := estimateTokens(body)
	seen := map[string]bool{path: true}
	for _, ref := range memoryImports(body) {
		resolved := ref
		if !filepath.IsAbs(resolved) {
			resolved = filepath.Join(filepath.Dir(path), resolved)
		}
		if seen[resolved] {
			continue
		}
		seen[resolved] = true
		total += readFileTokens(resolved)
	}
	return total
}

// memoryImports finds the `@relative/path.md` directives a memory file uses to
// pull in another file. Only a line that is nothing but the reference counts --
// an `@` mid-sentence is prose, and an email address is not an import.
func memoryImports(body string) []string {
	var refs []string
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 2 || line[0] != '@' {
			continue
		}
		ref := line[1:]
		if strings.ContainsAny(ref, " \t") || !strings.HasSuffix(ref, ".md") {
			continue
		}
		refs = append(refs, ref)
	}
	return refs
}

// maxContextFileBytes caps a single file's contribution. A stray multi-megabyte
// CLAUDE.md would otherwise dominate the panel and stall every scrub step.
const maxContextFileBytes = 1 << 20

type cachedFileTokens struct {
	Size     int64
	Modified int64
	Tokens   int64
}

// fileTokenCache mirrors contextSnapshotCache: scrubbing re-renders the panel
// on every step, and re-reading the same handful of files each time would turn
// a click into disk I/O.
var fileTokenCache = struct {
	sync.RWMutex
	entries map[string]cachedFileTokens
}{entries: make(map[string]cachedFileTokens)}

// readFileTokens estimates one context file, returning 0 for anything missing
// or outside the sandbox. The result is cached because the panel is rebuilt on
// every replayer step and would otherwise re-read the same files per click.
func readFileTokens(rawPath string) int64 {
	path, ok := allowedProjectFile(rawPath)
	if !ok {
		return 0
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() == 0 {
		return 0
	}
	modified := info.ModTime().UnixNano()

	fileTokenCache.RLock()
	cached, hit := fileTokenCache.entries[path]
	fileTokenCache.RUnlock()
	if hit && cached.Size == info.Size() && cached.Modified == modified {
		return cached.Tokens
	}

	body, _, ok := readContextFile(rawPath)
	if !ok {
		return 0
	}
	tokens := estimateTokens(body)

	fileTokenCache.Lock()
	fileTokenCache.entries[path] = cachedFileTokens{Size: info.Size(), Modified: modified, Tokens: tokens}
	fileTokenCache.Unlock()
	return tokens
}

// readContextFile returns a sandboxed file's contents along with its resolved
// path, truncated to the size cap.
func readContextFile(rawPath string) (string, string, bool) {
	path, ok := allowedProjectFile(rawPath)
	if !ok {
		return "", "", false
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return "", "", false
	}
	if len(body) > maxContextFileBytes {
		body = body[:maxContextFileBytes]
	}
	return string(body), path, true
}

// allowedProjectFile is allowedTranscriptPath's sibling for context files: the
// same absolute-path and EvalSymlinks containment rules, since the path being
// checked comes from a hook payload an agent controls. The root defaults to
// the user's home directory, which is where project checkouts and ~/.claude
// both live; TRACEFRAME_PROJECT_ROOT narrows it.
func allowedProjectFile(rawPath string) (string, bool) {
	if rawPath == "" || !filepath.IsAbs(rawPath) {
		return "", false
	}
	if filepath.Ext(rawPath) != ".md" {
		return "", false
	}
	home, _ := os.UserHomeDir()
	rawRoot := firstNonEmpty(strings.TrimSpace(os.Getenv("TRACEFRAME_PROJECT_ROOT")), home)
	if rawRoot == "" || !filepath.IsAbs(rawRoot) {
		return "", false
	}
	root, err := filepath.EvalSymlinks(rawRoot)
	if err != nil {
		return "", false
	}
	path, err := filepath.EvalSymlinks(rawPath)
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return path, true
}

// firstStringField returns the first key present as a non-empty string.
func firstStringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}
