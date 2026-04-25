---
type: domain
title: "Gaps Index"
status: seed
created: 2026-04-22
updated: 2026-04-22
subdomain_of: ""
page_count: 0
tags:
  - index
  - gaps
related:
  - "[[Master Index|index]]"
---

# Gaps

Open questions, contradictions between sources, and research needs that surfaced while ingesting or querying.

Each gap note captures: the precise question, where it came up, what would resolve it, and which sources touch on it.

## Open questions

> [!gap] Minimum essential span set
> Is there a canonical minimum set of spans that every agent trace should include? Candidates: `llm.call`, `tool.use`, `tool.result`, `agent.decision`, `agent.step`. Need sources.

> [!gap] Ground truth for agent trajectories
> Single-turn evals have reference answers. What's the reference for a multi-turn tool-using run? Intermediate state checks? Final outcome only? Trajectory similarity?

> [!gap] OTel GenAI coverage
> Does OpenTelemetry's GenAI semantic convention cover agent-level concepts (plans, reflections, sub-agent delegation) or only single LLM calls? Check current spec version.

> [!gap] Failure mode taxonomy
> Is there an agreed vocabulary for agent failure modes? Or is every paper inventing its own?

## Contradictions

_(none flagged yet)_
