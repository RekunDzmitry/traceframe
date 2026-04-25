---
type: overview
title: "Overview"
status: seed
created: 2026-04-22
updated: 2026-04-22
tags:
  - meta
  - overview
related:
  - "[[Master Index|index]]"
  - "[[Hot Cache|hot]]"
---

# LLM Agent Observability — Overview

This is the executive summary of the field. Update as the wiki matures.

## Scope

Observability of systems where one or more LLMs drive control flow — picking tools, making decisions, looping, delegating to sub-agents. Distinct from "LLM observability" (single-call monitoring) by the presence of multi-step reasoning, tool use, and emergent behavior.

## Core Questions

> [!gap] What are the essential spans?
> Is there a minimum set of span types every agent trace must include (plan, act, observe, reflect)? Or is this domain-specific?

> [!gap] How do we evaluate an agent trace, not just a single output?
> Success criteria span multiple turns: did it reach the goal, was the path efficient, did it recover from errors? Standard LLM evals don't cover this.

> [!gap] What counts as "the truth" for an agent run?
> For single-shot calls we have ground-truth answers. For agent runs with branching tool calls, what is the reference trajectory?

## Dimensions

The field can be cut along several axes (each will become a [[Thesis Index|thesis]] page as the wiki grows):

- **Instrumentation layer**: SDK hooks (provider) · framework hooks (LangChain/LlamaIndex/CrewAI) · protocol spans (OTel GenAI) · transcript parsing (post-hoc)
- **Data shape**: spans + attributes (OTel) · events (append-only) · transcripts (JSONL) · structured runs (LangSmith-style)
- **Signal**: cost · latency · token usage · tool-use graph · success/failure · human feedback · automated eval scores
- **Evaluation**: offline replay · online canary · LLM-as-judge · human review · ground-truth comparison

## Relationship to the Host Project

This vault sits inside the `traceframe` project — a zero-dep local prototype for ingesting Claude Code session traces as append-only JSONL events. `traceframe` is both a consumer of this research and a potential case-study source.

Relevant files in the project root:
- `data-model.html` — design doc for the event/trace schema
- `observability.html` — prototype dashboard
- `ingest/server.mjs` — the running ingest server
- `bin/traceframe` — the hook CLI that streams session transcripts

These should eventually get ingested into `.raw/` and summarized in `sources/`.
