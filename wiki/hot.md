---
type: meta
title: "Hot Cache"
status: evergreen
created: 2026-04-22
updated: 2026-04-22
tags:
  - meta
  - hot
---

# Recent Context

## Last Updated
2026-04-22. Vault scaffolded. Empty — no sources ingested yet.

## Key Recent Facts
- Vault purpose: research knowledge base on **observability of LLM agents** — tracing, evaluation, metrics, failure modes, tooling.
- Co-located with the `traceframe` project (a local prototype for ingesting Claude Code session traces) — that project can serve as a case-study source once ingested.

## Recent Changes
- Created: [[Master Index|index]], [[Overview]], [[Papers Index|papers/_index]], [[Entities Index|entities/_index]], [[Concepts Index|concepts/_index]], [[Thesis Index|thesis/_index]], [[Gaps Index|gaps/_index]]
- Created: 8 note templates under `wiki/_templates/`
- Applied: CSS snippet `vault-colors.css` for folder + callout coloring

## Active Threads
- Nothing ingested yet. First natural sources: the project's own `data-model.html` and `observability.html`, plus canonical references (OpenTelemetry GenAI semconv, LangSmith/LangFuse/Arize docs, Anthropic tool-use tracing guidance, eval frameworks like Ragas / DeepEval).
- Open question: which tracing standard(s) to treat as the backbone — OTel GenAI semantic conventions vs. vendor-specific span shapes.
