---
type: meta
title: "Conventions"
status: evergreen
created: 2026-04-22
updated: 2026-04-22
tags:
  - meta
  - conventions
related:
  - "[[Master Index|index]]"
---

# Wiki Conventions

## Frontmatter
- Flat YAML only — no nested objects (Obsidian's Properties UI requires flat).
- Universal fields: `type`, `title`, `status`, `created`, `updated`, `tags`, `related`, `sources`.
- Dates as `YYYY-MM-DD` strings.
- Lists as `- item`, not `[a, b, c]`.
- Wikilinks in YAML fields must be quoted: `"[[Page Name]]"`.
- Update `updated` every time you touch a page.

## Status values
- `seed` — exists, barely populated
- `developing` — real content, incomplete
- `mature` — comprehensive, well-linked
- `evergreen` — unlikely to need updates (overview, index, log, hot)

## Wikilinks
- `[[Page Name]]` — filenames are unique across the vault.
- `[[Page Name|display text]]` — when the display differs from the filename.

## Custom callouts
| Callout | Use |
|---|---|
| `> [!key-insight]` | The most important takeaway from a section |
| `> [!contradiction]` | Two wiki pages disagree; flag for resolution |
| `> [!gap]` | Topic has no source yet; actionable research need |
| `> [!stale]` | Claim may be outdated |

## Folder rules
- `.raw/` is immutable — never edit source documents after drop.
- `wiki/index.md` — master catalog; update on every ingest.
- `wiki/log.md` — append-only; newest at top; never rewrite history.
- `wiki/hot.md` — overwritten end-of-session; keep under ~500 words.
- `wiki/_templates/` — prototypes, not live pages; don't wikilink into them.

## When to create vs. extend
- If a new source introduces a concept already in `concepts/`, extend the existing page. Don't duplicate.
- If an entity has ≥2 mentions across sources, give it its own note.
- If an open question is precise and resolvable, file it under `gaps/`. If it's vague, leave it as a `> [!gap]` callout on the relevant page.
