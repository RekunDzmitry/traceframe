# .raw/ — Immutable Source Documents

Drop raw sources here. Never edit them after drop. Organize by shape:

- `papers/` — PDFs, paper exports, preprints
- `articles/` — blog posts, web clips, defuddled HTML
- `transcripts/` — talks, podcast transcripts, interview notes

Say "ingest [filename]" (or "ingest the latest papers") and Claude will:

1. Read the source.
2. Create a summary page under `wiki/sources/`.
3. Extract entities, concepts, and claims into their respective folders.
4. Update `wiki/index.md`, `wiki/log.md`, `wiki/hot.md`.

If a source is cold (no longer relevant), move it to `.archive/` to keep this folder clean.
