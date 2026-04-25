# LLM Agent Observability — Wiki

Mode: E (Research)
Purpose: Build a persistent, cross-referenced knowledge base on observability of LLM-based agents — papers, concepts, tools, open questions.
Owner: Dzmitry Rekun
Created: 2026-04-22

## Structure

```
.raw/                      # immutable source documents (never edit)
  papers/                  # PDFs, paper exports
  articles/                # blog posts, web clips
  transcripts/             # talks, podcasts, interviews

wiki/                      # LLM-generated knowledge base
  index.md                 # master catalog of all pages
  log.md                   # append-only operations journal (newest on top)
  hot.md                   # ~500-word recent context cache
  overview.md              # executive summary of the field
  sources/                 # one summary page per .raw source
  papers/                  # paper summaries (claim, method, results)
  entities/                # people, orgs, products, repos, datasets
  concepts/                # ideas, metrics, architectures, frameworks
  thesis/                  # evolving synthesis pages: "state of X"
  gaps/                    # open questions, contradictions, research needs
  comparisons/             # side-by-side: tools / approaches / techniques
  questions/               # filed answers to user queries
  meta/                    # dashboards, lint reports, conventions
  _templates/              # frontmatter templates for each note type

.obsidian/
  snippets/vault-colors.css  # folder/graph color coding
```

## Conventions

- Every note uses flat YAML frontmatter: `type`, `title`, `status`, `created`, `updated`, `tags`, plus `related` and `sources` wikilinks.
- Wikilinks: `[[Note Name]]`, filenames are unique across the vault.
- `.raw/` is immutable — never edit source documents after drop.
- `wiki/index.md` is the master catalog — update on every ingest.
- `wiki/log.md` is append-only — newest entries at the top, never rewrite history.
- `wiki/hot.md` is overwritten end-of-session with a ~500-word recent-context summary.
- `status` values: `seed` | `developing` | `mature` | `evergreen`.
- Dates: `YYYY-MM-DD` strings, not ISO datetime.
- Update `updated` every time you touch a page.

## Custom Callouts

Defined in `.obsidian/snippets/vault-colors.css` — render only when the snippet is enabled.

- `> [!key-insight]` — the most important takeaway from a section
- `> [!contradiction]` — two wiki pages disagree; flag for resolution
- `> [!gap]` — topic has no source yet; actionable research need
- `> [!stale]` — claim may be outdated; source past freshness threshold

## Operations

| User says | Skill |
|-----------|-------|
| "ingest [source]", "add this to the wiki" | `wiki-ingest` |
| "what do you know about X", "query" | `wiki-query` |
| "lint", "health check" | `wiki-lint` |
| "save this", "/save" | `save` |
| "/autoresearch [topic]" | `autoresearch` |
| "/canvas" | `canvas` |

## Cross-Project Referencing

Another Claude Code project can reference this vault without duplicating context. In its CLAUDE.md:

```markdown
## Wiki Knowledge Base
Path: ~/github/traceframe

When you need context on LLM observability not in this project:
1. Read wiki/hot.md first (~500 words)
2. If not enough, read wiki/index.md
3. For a domain, read the sub-folder's _index.md
4. Only then read individual pages

Do NOT read the wiki for general coding questions or things already in this repo.
```
