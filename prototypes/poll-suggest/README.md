# AI poll suggestions — eval harness

Evaluates the quality of the LLM-generated "predicted next polls" that power the
create-poll search box (migration 145). It runs the REAL generation pipeline
(`server/services/poll_suggest.py: generate_from_history`) over realistic
scenarios and prints the structured suggestions + metrics, so prompt/model
changes can be judged and compared.

- `scenarios.py` — labeled (group history, user history) scenarios as poll dicts.
- `eval.py` — builds a `HistoryContext` from each scenario (no DB), calls the
  LLM, validates (the same deterministic filter the server applies), prints the
  output + per-scenario + aggregate metrics.

## Running

The LLM (Ollama) is reachable from a per-branch dev container via
`host.docker.internal`, so the simplest path is to exec inside one:

```bash
bash scripts/remote-mac.sh "docker exec whoeverwants-dev-<slug> sh -c \
  'cd /repo/server && uv run python ../prototypes/poll-suggest/eval.py'" / 600
```

Or point it at canary's authenticated Ollama route from anywhere:

```bash
POLL_VARIANT_LLM_URL=https://ollama.dev.whoeverwants.com/v1/chat/completions \
POLL_VARIANT_LLM_MODEL=qwen3:14b \
POLL_VARIANT_LLM_API_KEY=<token> \
uv run python prototypes/poll-suggest/eval.py
```

Flags: `--model <id>` to compare models, `--rounds N` to sample the
non-deterministic output N times per scenario.

## What "good" looks like

A strong run produces, per scenario, 4–6 suggestions that:
- are **distinct** from each other and from the listed history (the validator
  drops exact dups, but near-dups are a prompt-quality signal),
- **match the group/user pattern** (a foodie group → a fresh restaurant/movie
  decision; a work team → a yes/no + a scheduling poll),
- have **plausible, concise** titles/options/contexts a real person would type,
- spread across a **couple of categories** (not six identical restaurant polls).

Iterate `_SYSTEM_PROMPT` / `MAX_SUGGESTIONS` in `services/poll_suggest.py` (and
optionally `POLL_SUGGEST_LLM_MODEL`) until the outputs read well, then re-run.
