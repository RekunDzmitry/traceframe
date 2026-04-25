---
type: meta
title: "Master Index"
status: evergreen
created: 2026-04-22
updated: 2026-04-22
tags:
  - meta
  - index
---

# Master Index

The master catalog of every page in this wiki. Updated on every ingest and significant edit.

See `[[Overview]]` for the executive summary of the field.

## Navigation

- `[[Overview]]` — executive summary
- `[[Hot Cache|hot]]` — last ~500 words of context
- `[[Log]]` — chronological operations journal

## Domains

| Area | Purpose | Count |
|------|---------|-------|
| [[Papers Index\|papers/_index]] | Paper summaries (claim, method, results) | 0 |
| [[Entities Index\|entities/_index]] | People, orgs, products, repos, datasets | 0 |
| [[Concepts Index\|concepts/_index]] | Ideas, metrics, architectures, frameworks | 0 |
| [[Thesis Index\|thesis/_index]] | Evolving synthesis — state of the field | 0 |
| [[Gaps Index\|gaps/_index]] | Open questions, contradictions, research needs | 0 |

## Other Folders

- `sources/` — one summary page per `.raw/` source
- `comparisons/` — side-by-side analyses
- `questions/` — filed answers to user queries
- `meta/` — dashboards, lint reports

## How to Contribute

1. Drop a source into `.raw/papers/`, `.raw/articles/`, or `.raw/transcripts/`.
2. Say "ingest [filename]" — Claude creates a source summary + extracts entities, concepts, claims.
3. Ask questions — Claude files good answers into `questions/` and cross-links.
4. Run lint every so often — it finds orphans, stale pages, dead wikilinks.
