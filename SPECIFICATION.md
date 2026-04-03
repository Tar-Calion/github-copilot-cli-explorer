# Copilot News Agent — Complete Specification

> **Purpose**: This specification is detailed enough to regenerate the entire application
> from scratch. Every behavior, data structure, API call, and edge case is defined.

---

## 1. Overview

### 1.1 Problem
GitHub Copilot CLI receives near-daily releases. Relevant information is scattered
across four sources (GitHub Releases, GitHub Blog, GitHub Docs, Reddit). A user
cannot efficiently track what changed, what is new, and what to try next.

### 1.2 Solution
A **native Copilot CLI custom agent** defined as a Markdown agent profile
(`.github/agents/copilot-news.agent.md`). The agent uses only built-in CLI tools
(`shell`/`bash` for HTTP requests, `view`/`edit`/`create` for file I/O). No
JavaScript extension is required — the CLI auto-discovers the agent profile and
its companion skill file.

### 1.3 Design Decisions

| Decision               | Choice                                                      |
|------------------------|-------------------------------------------------------------|
| Agent type             | **Native agent profile** — `.github/agents/copilot-news.agent.md` |
| Runtime                | Pure Markdown — no JavaScript, no SDK, no extension process |
| Output language        | **English**                                                  |
| Output format          | Markdown report (saved) + terminal summary                  |
| Trigger mechanism      | **`/agent` invocation** or `--agent=copilot-news` CLI flag  |
| Feedback loop          | **None** — user asks the agent to update preferences inline  |
| Changelog integration  | No                                                          |
| Report history         | Yes — timestamped files in `reports/`                       |
| Try-it-out suggestions | Yes — every feature item gets an actionable suggestion      |
| Docs linking           | Yes — via `copilot-news` skill (auto-discovered)            |
| Release note filtering | Features only — bug fixes and performance items filtered    |
| State persistence      | JSON file in `data/state.json` (read/written by the agent)  |

---

## 2. File Structure

```
github-copilot-cli-explorer/
├── .github/
│   ├── agents/
│   │   └── copilot-news.agent.md      ← Agent profile (auto-discovered by CLI)
│   └── skills/
│       └── copilot-news/
│           └── SKILL.md               ← Skill: docs URL map (auto-discovered by CLI)
├── data/
│   └── state.json                     ← Persisted agent state
├── reports/
│   ├── .gitkeep.md                    ← Ensures directory is tracked by git
│   └── YYYY-MM-DD.md                  ← Auto-generated reports
└── README.md
```

**Auto-discovery rules (no configuration needed):**
- The CLI scans `.github/agents/` for `*.agent.md` files at session start.
- The CLI scans `.github/skills/` for subdirectories containing `SKILL.md`.
- `data/` and `reports/` are read/written by the agent using built-in `view`/`edit`/`create` tools.

---

## 3. Agent Architecture

### 3.1 High-Level Flow

```
User runs: /agent → selects "Copilot News"  (or: copilot --agent=copilot-news)
         │
         ▼
┌───────────────────────────────────────────────────────────────────────┐
│  CLI auto-discovers .github/agents/copilot-news.agent.md             │
│  CLI auto-discovers .github/skills/copilot-news/SKILL.md             │
│  No JavaScript, no SDK, no extension process needed                  │
└───────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Copilot News Agent — guided by agent profile + skill context        │
│                                                                       │
│  Step 1: view data/state.json                                        │
│  Step 2: shell (curl) → GitHub Releases API                          │
│          shell (curl) → GitHub Blog RSS feed                         │
│          shell (curl) → Reddit JSON API                              │
│  Step 3: Filter against knownTopics and excludedKeywords             │
│  Step 4: Add docs links using /copilot-news skill                    │
│  Step 5: create reports/YYYY-MM-DD.md                                │
│  Step 6: edit data/state.json (lastCheck + new knownTopics)          │
│  Step 7: Present scannable terminal summary                          │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Profile Format

File: `.github/agents/copilot-news.agent.md`

```markdown
---
name: copilot-news
description: <one-line description for /agent picker>
---

<Markdown body: the agent's system prompt and workflow instructions>
```

### 3.3 Skill File Format

File: `.github/skills/copilot-news/SKILL.md`

```markdown
---
name: copilot-news
description: <when Copilot should load this skill>
---

<Markdown body: docs URL reference table>
```

The skill is loaded when the agent references `/copilot-news` or the model judges it relevant.

### 3.4 Built-in Tools Used

| Tool | Purpose |
|------|---------|
| `shell` / `bash` | HTTP requests via `curl` to GitHub, Blog, Reddit |
| `view` | Read `data/state.json` |
| `edit` | Update `data/state.json` after run |
| `create` | Write `reports/YYYY-MM-DD.md` |

---

## 4. Agent Invocation

The CLI auto-discovers `copilot-news.agent.md` from `.github/agents/`. No setup needed.

**Options to invoke:**
1. `/agent` → select **Copilot News** from the list.
2. Reference in a prompt: "Use the copilot-news agent to fetch recent updates".
3. CLI flag: `copilot --agent=copilot-news --prompt "fetch recent Copilot news"`.

---

## 5. State Management

### 5.1 State Schema

File: `data/state.json`

```jsonc
{
    // ISO 8601 timestamp of the last successful check, or null if never run
    "lastCheck": "2026-04-03T09:37:21.000Z" | null,

    // Array of topics the user has already seen / acknowledged
    "knownTopics": [
        {
            "id":     "release-v1.0.17",         // REQUIRED — unique identifier
            "title":  "Release v1.0.17",          // REQUIRED — human-readable
            "date":   "2026-04-02",               // OPTIONAL — ISO date string
            "source": "releases"                  // REQUIRED — one of: releases|blog|reddit|docs
        }
    ],

    // Keywords to permanently filter out (case-insensitive substring match)
    "excludedKeywords": ["streamer-mode", "enterprise-billing"],

    // User preferences
    "preferences": {
        "lookbackDays": 14,          // How many days to look back for content
        "focusAreas": ["extensions", "mcp"]  // Optional priority areas
    }
}
```

### 5.2 Topic ID Conventions

Each source generates topic IDs with a predictable prefix:

| Source   | ID Pattern                                  | Example                                  |
|----------|---------------------------------------------|------------------------------------------|
| Releases | `release-{tag_name}`                        | `release-v1.0.17`                        |
| Blog     | `blog-{url_slug}`                           | `blog-run-multiple-agents-at-once-with-fleet-in-copilot-cli` |
| Reddit   | `reddit-{post_id}`                          | `reddit-1sb938g`                         |
| Docs     | `docs-{section}`                            | `docs-main`, `docs-whats-new`            |

IDs are stable across runs — the same content always generates the same ID.

### 5.3 Default State (initial `data/state.json`)

```json
{
    "lastCheck": null,
    "knownTopics": [],
    "excludedKeywords": [],
    "preferences": {
        "lookbackDays": 14,
        "focusAreas": []
    }
}
```

### 5.4 State Helper Functions

```js
function loadState() {
    if (!existsSync(STATE_PATH)) {
        return {
            lastCheck: null,
            knownTopics: [],
            excludedKeywords: [],
            preferences: { lookbackDays: 14, focusAreas: [] },
        };
    }
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

function saveState(state) {
    const dir = join(CWD, "data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function cutoffDate(lookbackDays) {
    const d = new Date();
    d.setDate(d.getDate() - lookbackDays);
    return d.toISOString();
}
```

---

## 6. Built-in Tools Used

The agent uses only the Copilot CLI's **built-in tools** — no custom JavaScript handlers.

### 6.1 `shell` / `bash`

Used to make HTTP requests with `curl`. Adapt to the OS if needed (`curl.exe` on Windows).

**GitHub Releases:**
```bash
curl -s -H "Accept: application/vnd.github+json" -H "User-Agent: copilot-news-agent" \
  "https://api.github.com/repos/github/copilot-cli/releases?per_page=15"
```

**GitHub Blog RSS:**
```bash
curl -s -H "User-Agent: copilot-news-agent/1.0" \
  "https://github.blog/ai-and-ml/github-copilot/feed/"
```

**Reddit:**
```bash
curl -s -H "User-Agent: copilot-news-agent/1.0" \
  "https://www.reddit.com/r/GithubCopilot/new.json?limit=15"
```

### 6.2 `view`

Read `data/state.json` to load the agent's persisted state.

### 6.3 `edit`

Update `data/state.json` after each run (update `lastCheck`, append to `knownTopics`).

### 6.4 `create`

Write the news report to `reports/YYYY-MM-DD.md`. If the file exists, increment
the counter: `reports/YYYY-MM-DD-2.md`, `-3.md`, etc.
---

## 7. Report Format

The LLM generates this markdown. The format is specified in `AGENT_PROMPT`.

```markdown
# Copilot CLI News — {YYYY-MM-DD}

> Sources: GitHub Releases · GitHub Blog · Reddit
> Lookback: {N} days

---

## 🆕 New Features

### {Feature Name} (source: releases {version})
{1–2 sentence summary}

**Try it out:** `{exact CLI command or steps}`
📖 [Docs]({relevant docs URL})

### {Feature Name} (source: blog)
{Summary}

**Read:** {url}
📖 [Docs]({relevant docs URL})

---

## ✍️ Blog Posts

### {Post Title}
{Summary}

**Read:** {url}
📖 [Docs]({relevant docs URL})

---

## 💬 Community Highlights

### {Post Title} (score: {N})
{Summary of the discussion}

**Discussion:** {url}

---

## ℹ️ Excluded by Preference
The following keywords were filtered out: {comma-separated list or "none"}

---

## 📊 Statistics
- Releases checked: {N}
- Blog posts found: {N}
- Reddit posts scanned: {N}
- New items (after filtering): {N}
- Known items skipped: {N}
```

**Sections with no items** should appear with a note: "No new items in this category."

---

## 8. Agent Workflow (from agent profile)

The Markdown body of `.github/agents/copilot-news.agent.md` is the agent's system prompt.
Key steps (see the actual file for full detail):

1. **Load state** — `view data/state.json`
2. **Fetch** — `shell` with curl to GitHub Releases, Blog RSS, Reddit
3. **Filter** — skip known topics, excluded keywords, bug-fix/perf release lines
4. **Docs links** — use `/copilot-news` skill URL table
5. **Save report** — `create reports/YYYY-MM-DD.md`
6. **Update state** — `edit data/state.json` (lastCheck + new knownTopics merged)
7. **Summary** — terminal-friendly bullet list

---

## 9. Error Handling

### 9.1 Network Errors

All fetch tools wrap their logic in try/catch. On failure, they return a string:
```
"Error fetching {source}: {error.message}"
```

The LLM should **continue processing** the other sources. A failure in one
source does not abort the entire workflow. The report should note which
sources failed.

### 9.2 State File Errors

- Missing `data/state.json` → return default state (never crash).
- Corrupt JSON → wrap `JSON.parse` in try/catch, return default state, log
  warning via `session.log("⚠️ State file corrupt, using defaults", { level: "warning" })`.
- Missing `data/` directory → create with `mkdirSync({ recursive: true })`.

### 9.3 Report File Errors

- Missing `reports/` directory → create automatically.
- Same-day duplicate → auto-increment counter (see §6.7).
- Disk write failure → handler throws, tool result becomes failure.

### 9.4 Rate Limiting

| Source  | Limit                | Mitigation                              |
|---------|----------------------|-----------------------------------------|
| GitHub  | 60 req/hr (unauth)   | Only fetches 1 page per run             |
| Reddit  | ~100 req/10min       | Single request per run                  |
| Blog    | No known limit       | Single request per run                  |

If the extension is used as designed (every few days), rate limits are not a concern.

---

## 10. Agent Lifecycle

There is no separate extension process. The agent profile is a static Markdown file
that the CLI loads at session start. There is no startup message, no reload mechanism,
and no shutdown handler.

State lives entirely in `data/state.json` (written by the agent's `edit` tool calls).
If the user clears the session (`/clear`), the agent profile is re-read from disk — no
in-memory state is lost because there is no in-memory state.

---

## 11. Preference Updates

There is no separate feedback loop. The user asks the agent to update preferences inline:

- "Exclude anything about streamer-mode" → agent edits `data/state.json` with new keyword in `excludedKeywords`.
- "Focus on MCP and extensions next time" → agent edits `data/state.json` with updated `preferences.focusAreas`.

---

## 12. "Try It Out" Suggestion Guidelines

The LLM follows these guidelines when generating try-it-out suggestions:

1. **New CLI features**: Provide the exact `copilot` command or slash command.
   Example: "Run `copilot` and type `/fleet` to try fleet mode."

2. **Configuration changes**: Show the exact setting or flag.
   Example: "Launch with `copilot --experimental` to enable new features."

3. **Extension features**: Show how to create/modify extension files.
   Example: "Create `.github/extensions/my-ext/extension.mjs` with..."

4. **MCP features**: Show the `/mcp` command or config changes.
   Example: "Run `/mcp` to see connected servers, then..."

5. **Bug fixes**: Explain what previously didn't work and confirm it's fixed.
   Example: "Previously, Ctrl+D queued a message. Now it shuts down cleanly."

6. **Blog/docs content**: Link to the resource and summarize the key takeaway.
   Example: "Read the full guide at {url}. Key takeaway: ..."

7. **Reddit discussions**: Summarize the community insight and link.
   Example: "Community tip from u/{author}: {summary}. Discussion: {url}"

---

## 13. Testing Checklist

After implementation, verify:

- [ ] `/agent` command lists "Copilot News" (auto-discovered from `.github/agents/`)
- [ ] `/skills list` shows `copilot-news` skill (auto-discovered from `.github/skills/copilot-news/`)
- [ ] Agent reads `data/state.json` with the `view` tool
- [ ] Agent runs `curl` calls to GitHub Releases, Blog RSS, and Reddit via `shell`
- [ ] Release results exclude bug fix / perf lines
- [ ] Each feature in the report has a `📖 [Docs](url)` link from the skill
- [ ] Report is created at `reports/YYYY-MM-DD.md` via `create`
- [ ] Same-day re-run creates `{date}-2.md` instead of overwriting
- [ ] Agent updates `data/state.json` with `lastCheck` and merged `knownTopics`
- [ ] User can update exclusions inline: "exclude X from now on"

---

## 14. Future Enhancements (Out of Scope)

These are noted for potential future work but are NOT part of the current spec:

1. **GitHub authentication** for releases API — higher rate limits.
2. **Diff-based docs tracking** — store docs content hash, detect actual changes.
3. **Scheduled checks** — auto-trigger on session start if N days since last check.
4. **RSS feed for blog** — more reliable than HTML scraping (feed URL discovered:
   `https://github.blog/ai-and-ml/github-copilot/feed/`).
5. **Multiple subreddits** — also track r/vscode, r/programming for Copilot mentions.
6. **User-level extension** — move to `~/.copilot/extensions/` for cross-repo access.
7. **Topic deduplication** across sources — detect when a release and blog post
   cover the same feature.
8. **Trending detection** — highlight topics mentioned in multiple sources.
