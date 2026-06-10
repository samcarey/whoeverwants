---
name: scoped-commits
description: >-
  Write git commit messages in the Scoped Commits format (scopedcommits.com)
  for this project. Use whenever creating a commit, drafting a commit message,
  or writing a PR title. This REPLACES Conventional Commits — do NOT use
  feat:/fix:/chore: type prefixes here.
---

# Scoped Commits (scopedcommits.com)

This project uses **Scoped Commits**, NOT Conventional Commits. Every commit
message (and PR title) follows this convention.

## Format

```
<scope>: <description>

[optional body]

[optional trailer(s)]
```

- **`<scope>`** — the subsystem, area, or module being touched (the most
  important part, placed up front so logs scan fast). Examples for this
  codebase: `polls`, `groups`, `auth`, `notifications`, `ios`, `create-poll`,
  `droplet`, `migrations`, `social_tests`, `ci`.
- **`<description>`** — concise, imperative summary of the change.
- **body** — optional, explains the *why* / details.
- **trailers** — optional metadata lines.

## Rules

1. **No type prefixes.** Do NOT write `feat:`, `fix:`, `chore:`, `docs:`,
   `refactor:` etc. The leading token is a *scope* (where), not a *type*
   (what kind). `auth: reject expired magic links` ✅, `fix: ...` ❌.
2. **Lead with the scope**, lowercase, followed by `: `.
3. **Multiple areas** — pick one of:
   - a broader encompassing scope, or
   - comma-separated scopes (`groups, notifications: ...`), or
   - a treewide marker (`treewide:` / `global:`) for sweeping changes.
4. **Special commits** (merges, reverts) may use any format.
5. **Changelogs are NOT generated from commit logs.** Commit logs are for
   developers understanding code evolution; changelogs are a separate,
   user-facing artifact. Don't shape messages to feed a changelog tool.
6. **Project trailer (mandatory):** end every commit message with the session
   URL trailer on its own line:
   ```
   https://claude.ai/code/session_01QVnNXHxe3TnbiAPa7BN11S
   ```

## Examples

```
groups: add per-group admin set (migration 142)
auth: reject expired magic links at /verify
notifications, polls: suppress poll-closed push for Old-set viewers
ios: scope associated-domains entitlement to the tier host
treewide: rename threads -> groups
```

## When committing

- Compose the subject as `<scope>: <imperative summary>`.
- Add a body only when the change needs a *why*.
- Always append the session-URL trailer.
- Never push to `main`; commit on the feature branch and open a PR (the PR
  title also uses Scoped Commits format).
