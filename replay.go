package main

// The history replayer scrubs a session forward and backward one row at a
// time. "Row" means what the timeline actually draws inside a turn -- the
// prompt, each tool, then the response -- so a step in the UI is a step in
// this list, with no hidden events in between.
//
// The cursor is an integer position rather than an event id because the
// controls are relative (<< < > >>) and a position survives a row vanishing
// under a filter change; an id would dangle. Ordering is stable across
// requests: buildSummaries sorts chronologically and event ids are
// deterministic (event_natural_id), so step N is the same row on every poll.

// replayOrder is the flat list of event ids the timeline draws, in draw
// order. Its length is the replayer's upper bound.
func replayOrder(groups []userMessageGroup) []string {
	var ids []string
	for _, group := range groups {
		for _, t := range group.Turns {
			if t.Prompt != nil {
				ids = append(ids, t.Prompt.EventID)
			}
			for _, tool := range t.Tools {
				ids = append(ids, tool.EventID)
			}
			if t.Response != nil {
				ids = append(ids, t.Response.EventID)
			}
		}
	}
	return ids
}

// truncateToCursor returns the groups holding only the first cursor rows.
// Groups and turns that end up with nothing revealed are dropped rather than
// rendered empty, so the timeline grows a row at a time instead of showing a
// scaffold of blank turns.
//
// A cursor of 0 yields no groups (Timeline renders its empty state); a cursor
// at or past the end returns everything.
func truncateToCursor(groups []userMessageGroup, cursor int) []userMessageGroup {
	if cursor <= 0 {
		return nil
	}
	remaining := cursor
	out := make([]userMessageGroup, 0, len(groups))
	for _, group := range groups {
		if remaining <= 0 {
			break
		}
		revealed := userMessageGroup{ID: group.ID, Prompt: group.Prompt}
		for _, t := range group.Turns {
			if remaining <= 0 {
				break
			}
			partial := turn{StartedAt: t.StartedAt, EndedAt: t.EndedAt, Notes: t.Notes}
			rows := 0
			if t.Prompt != nil {
				partial.Prompt = t.Prompt
				remaining--
				rows++
			}
			for _, tool := range t.Tools {
				if remaining <= 0 {
					break
				}
				partial.Tools = append(partial.Tools, tool)
				remaining--
				rows++
			}
			if t.Response != nil && remaining > 0 {
				partial.Response = t.Response
				remaining--
				rows++
			}
			if rows == 0 {
				break
			}
			revealed.Turns = append(revealed.Turns, partial)
			revealed.ToolCount += len(partial.Tools)
		}
		if len(revealed.Turns) == 0 {
			break
		}
		out = append(out, revealed)
	}
	return out
}

// flattenRows returns the revealed rows themselves, which is what the usage
// panel measures. Notes are excluded for the same reason they are excluded
// from replayOrder: the timeline does not draw them.
func flattenRows(groups []userMessageGroup) []eventSummary {
	var rows []eventSummary
	for _, group := range groups {
		for _, t := range group.Turns {
			if t.Prompt != nil {
				rows = append(rows, *t.Prompt)
			}
			rows = append(rows, t.Tools...)
			if t.Response != nil {
				rows = append(rows, *t.Response)
			}
		}
	}
	return rows
}

// clampCursor keeps a requested step inside [0, total].
func clampCursor(cursor, total int) int {
	if cursor < 0 {
		return 0
	}
	if cursor > total {
		return total
	}
	return cursor
}

// applyFiltersToGroups narrows the grouped timeline to the rows passing the
// active filters, and reports which rows matched so collapsed groups holding a
// match can be force-opened (groupIsOpen). With no filter active the groups
// pass through untouched -- filtering is the exception, not the default path.
func applyFiltersToGroups(groups []userMessageGroup, filters timelineFilters) ([]userMessageGroup, map[string]bool) {
	if !filters.Active() {
		return groups, nil
	}
	matched := map[string]bool{}
	keeps := func(ev *eventSummary) bool {
		if ev == nil {
			return false
		}
		if len(filters.Apply([]eventSummary{*ev})) == 0 {
			return false
		}
		matched[ev.EventID] = true
		return true
	}
	out := make([]userMessageGroup, 0, len(groups))
	for _, group := range groups {
		kept := userMessageGroup{ID: group.ID, Prompt: group.Prompt}
		for _, t := range group.Turns {
			filtered := turn{StartedAt: t.StartedAt, EndedAt: t.EndedAt, Notes: t.Notes}
			if keeps(t.Prompt) {
				filtered.Prompt = t.Prompt
			}
			filtered.Tools = filters.Apply(t.Tools)
			for _, tool := range filtered.Tools {
				matched[tool.EventID] = true
			}
			if keeps(t.Response) {
				filtered.Response = t.Response
			}
			if filtered.Prompt == nil && filtered.Response == nil && len(filtered.Tools) == 0 {
				continue
			}
			kept.Turns = append(kept.Turns, filtered)
			kept.ToolCount += len(filtered.Tools)
		}
		if len(kept.Turns) == 0 {
			continue
		}
		out = append(out, kept)
	}
	return out, matched
}
