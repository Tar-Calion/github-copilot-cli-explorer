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
A **Copilot CLI Extension** that, on a trigger keyword, orchestrates the LLM agent
to fetch all sources, filter against the user's known/excluded topics, generate a
curated English-language report with actionable "try it out" suggestions, persist
the report, and collect feedback that refines future runs.

### 1.3 Design Decisions

| Decision               | Choice                                                      |
|------------------------|-------------------------------------------------------------|
| Extension scope        | **Project-level** — `.github/extensions/copilot-news/`      |
| Runtime                | Node.js ES Module (`.mjs`) using `@github/copilot-sdk`      |
| Output language        | **English**                                                  |
| Output format          | Markdown report (saved) + terminal summary                  |
| Trigger mechanism      | **`/agent` invocation** — user selects "Copilot News" agent |
| Feedback loop          | **None** — user may ask the agent to update preferences inline |
| Changelog integration  | No (skip built-in `/changelog`)                             |
| Report history         | Yes — timestamped files in `reports/`                       |
| Try-it-out suggestions | Yes — every notable item gets an actionable suggestion      |
| Docs linking           | Yes — each feature links to the relevant docs URL           |
| Release note filtering | Features only — bug fixes and performance items pre-filtered |
| State persistence      | JSON file in `data/state.json`                              |

---

## 2. File Structure

```
github-copilot-cli-explorer/
├── .github/
│   ├── extensions/
│   │   └── copilot-news/
│   │       └── extension.mjs          ← Single-file extension (entry point)
│   └── skills/
│       └── copilot-news.md            ← Skill: docs URL map for feature linking
├── data/
│   └── state.json                     ← Persisted agent state
├── reports/
│   ├── .gitkeep.md                    ← Ensures directory is tracked by git
│   ├── 2026-04-03.md                  ← Example report
│   └── 2026-04-10.md
└── README.md
```

- `extension.mjs` — MUST be named exactly this. Only `.mjs` is supported.
- `copilot-news.md` — Skill file in `skillDirectories`; loaded as context for the agent.
- `data/` and `reports/` are created automatically by tools if they don't exist.

---

## 3. Extension Architecture

### 3.1 High-Level Flow

```
User runs: /agent → selects "Copilot News"
         │
         ▼
┌───────────────────────────────────────────────────────────────────────┐
│  joinSession registers:                                               │
│  - customAgents: [{ name: "copilot-news", prompt: AGENT_PROMPT, ...}]│
│  - skillDirectories: [".github/skills"]                              │
│  - tools: [6 tool handlers]                                          │
└───────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Copilot News Agent — guided by AGENT_PROMPT + skill context         │
│                                                                       │
│  Step 1: Call copilot_news_load_state                                │
│  Step 2: Call all 3 fetchers IN PARALLEL:                            │
│          copilot_news_fetch_releases (features only, pre-filtered)   │
│          copilot_news_fetch_blog                                      │
│          copilot_news_fetch_reddit                                    │
│  Step 3: Filter against knownTopics and excludedKeywords             │
│  Step 4: For each new item → generate "Try it out" suggestion        │
│          and add docs link from skill reference                      │
│  Step 5: Call copilot_news_save_report with markdown report          │
│  Step 6: Call copilot_news_save_state (lastCheck + all topic IDs)    │
│  Step 7: Present scannable terminal summary                          │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Imports

```js
import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
```

`@github/copilot-sdk` is auto-resolved by the CLI — do NOT `npm install` it.

### 3.3 Constants and State

```js
const CWD         = process.cwd();                    // Repo root
const STATE_PATH  = join(CWD, "data", "state.json");  // State file
const REPORTS_DIR = join(CWD, "reports");             // Report directory
const SKILLS_DIR  = join(CWD, ".github", "skills");   // Skill files
```

### 3.4 joinSession Configuration

```js
const session = await joinSession({
    skillDirectories: [SKILLS_DIR],
    customAgents: [
        {
            name:        "copilot-news",
            displayName: "Copilot News",
            description: "Research and summarize recent GitHub Copilot CLI developments",
            tools:       TOOLS.map((t) => t.name),
            prompt:      AGENT_PROMPT,
        },
    ],
    tools: TOOLS,
});
```

- `skillDirectories` loads `.github/skills/copilot-news.md` as persistent context.
- `customAgents.tools` restricts the agent to only the 6 news tools.
- `customAgents.prompt` is the agent's system prompt (replaces WORKFLOW_INSTRUCTIONS).

---

## 4. Agent Invocation

The extension registers a **named custom agent** instead of a keyword hook. The user
invokes it explicitly:

1. Start Copilot CLI from the repo root: `cd github-copilot-cli-explorer && copilot`
2. Type `/agent` and select **Copilot News** from the list.
3. Send any message to start the workflow (e.g. "fetch recent Copilot news").

There is no keyword hook (`onUserPromptSubmitted` is not used). The agent is entirely
opt-in via `/agent`.

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

## 6. Tools — Complete Specifications

Each tool is registered in the `tools` array of `joinSession()`. Every tool
returns a **string** (success) or a string prefixed with `"Error:"` (failure).

### 6.1 `copilot_news_load_state`

**Purpose**: Load the persisted agent state so the LLM knows what the user has
already seen and what to exclude.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_load_state`                                             |
| Description   | "Load the Copilot News agent state: known topics, excluded keywords, preferences, and last check date." |
| Parameters    | `{ type: "object", properties: {} }` (no arguments)                  |
| Returns       | Pretty-printed JSON string of the full state object                  |

**Handler**:
```js
handler: async () => {
    const state = loadState();
    return JSON.stringify(state, null, 2);
}
```

**Edge cases**:
- If `data/state.json` doesn't exist → return default state (never crashes).
- If the file is corrupt JSON → the extension process crashes; the CLI will log
  an error. **Mitigation**: wrap in try/catch and return default state on parse error.

---

### 6.2 `copilot_news_save_state`

**Purpose**: Persist the updated state after the user provides feedback.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_save_state`                                             |
| Description   | "Save the updated Copilot News agent state. Provide the full state object including knownTopics, excludedKeywords, preferences, and lastCheck." |

**Parameters schema**:
```json
{
    "type": "object",
    "properties": {
        "lastCheck": {
            "type": "string",
            "description": "ISO 8601 timestamp of this check"
        },
        "knownTopics": {
            "type": "array",
            "description": "Array of known topic objects with id, title, date, source fields",
            "items": {
                "type": "object",
                "properties": {
                    "id":     { "type": "string" },
                    "title":  { "type": "string" },
                    "date":   { "type": "string" },
                    "source": { "type": "string" }
                },
                "required": ["id", "title", "source"]
            }
        },
        "excludedKeywords": {
            "type": "array",
            "description": "Array of keyword strings to permanently exclude",
            "items": { "type": "string" }
        },
        "preferences": {
            "type": "object",
            "description": "User preferences object",
            "properties": {
                "lookbackDays": { "type": "number" },
                "focusAreas": {
                    "type": "array",
                    "items": { "type": "string" }
                }
            }
        }
    },
    "required": ["lastCheck", "knownTopics", "excludedKeywords"]
}
```

**Handler behavior**:
1. Load current state (to preserve any fields the LLM didn't send).
2. Merge: use provided values, fall back to current state for missing fields.
3. Write to `data/state.json` with 2-space indentation + trailing newline.
4. Return confirmation string: `"State saved. {N} known topics, {M} excluded keywords."`

**Edge cases**:
- `data/` directory doesn't exist → create with `mkdirSync({ recursive: true })`.
- `preferences` is not provided → keep current `preferences`.
- `knownTopics` can grow unbounded — the LLM should be instructed to merge
  (append new, keep old) rather than replace.

---

### 6.3 `copilot_news_fetch_releases`

**Purpose**: Fetch recent Copilot CLI releases, pre-filtered to new features only.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_fetch_releases`                                         |
| Description   | "Fetch recent GitHub Copilot CLI releases. Returns only new features — bug fixes and performance improvements are pre-filtered." |

**Parameters schema**:
```json
{
    "type": "object",
    "properties": {
        "max_releases": {
            "type": "number",
            "description": "Maximum number of releases to fetch (default: 15)"
        }
    }
}
```

**API endpoint**: `GET https://api.github.com/repos/github/copilot-cli/releases?per_page={max_releases}`

**Request headers**:
```
Accept: application/vnd.github+json
User-Agent: copilot-news-extension
```

**No authentication** — the GitHub releases API is public. Rate limit: 60 req/hr
for unauthenticated requests (sufficient for periodic use).

**Response processing**:
1. Parse JSON array of release objects.
2. Compute cutoff date = `now - state.preferences.lookbackDays` days.
3. Filter: only releases where `published_at >= cutoff` and `prerelease === false`.
4. Apply `filterFeaturesOnly(body)` to each release's `body`:
   - Drop lines matching bug-fix patterns: `/^(Fix|Resolve|Correct|Patch|Revert)\b/i`,
     `/\bno longer\b/i`, `/\bnow correctly\b/i`.
   - Drop lines matching perf patterns: `/\b(loads?\s+\w+\s+faster|significantly faster|performance improvement|optimiz)\b/i`.
5. Map each release to:
   ```json
   {
       "id":      "release-{tag_name}",
       "version": "{tag_name}",
       "name":    "{name}",
       "date":    "{published_at}",
       "url":     "{html_url}",
       "body":    "{filtered body truncated to 4000 chars}"
   }
   ```
6. Return JSON envelope:
   ```json
   { "source": "releases", "count": N, "items": [...] }
   ```

**GitHub API release object fields used**:

| Field           | Type    | Used for                              |
|-----------------|---------|---------------------------------------|
| `tag_name`      | string  | Version identifier + topic ID         |
| `name`          | string  | Human-readable release name           |
| `published_at`  | string  | ISO 8601 date for filtering           |
| `html_url`      | string  | Link to release page                  |
| `body`          | string  | Markdown release notes (truncate 3k)  |
| `prerelease`    | boolean | Flag pre-release versions             |

**Error handling**: On fetch failure or non-2xx response, return
`"Error: GitHub API returned HTTP {status}"` or `"Error fetching releases: {message}"`.

---

### 6.4 `copilot_news_fetch_blog`

**Purpose**: Fetch recent GitHub Copilot blog posts.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_fetch_blog`                                             |
| Description   | "Fetch recent GitHub Copilot blog posts from github.blog. Returns post titles, dates, summaries, and URLs." |

**Parameters schema**:
```json
{
    "type": "object",
    "properties": {
        "max_posts": {
            "type": "number",
            "description": "Maximum number of posts to return (default: 10)"
        }
    }
}
```

**Primary strategy — RSS feed** (preferred, more reliable):

**Endpoint**: `GET https://github.blog/ai-and-ml/github-copilot/feed/`

The blog exposes an RSS 2.0 feed. Parse XML to extract `<item>` elements.

Each `<item>` contains:
```xml
<item>
    <title>Run multiple agents at once with /fleet in Copilot CLI</title>
    <link>https://github.blog/ai-and-ml/github-copilot/run-multiple-agents-at-once-with-fleet-in-copilot-cli/</link>
    <pubDate>Wed, 02 Apr 2026 12:00:00 +0000</pubDate>
    <description><![CDATA[Excerpt text here...]]></description>
</item>
```

**Parsing logic** (regex-based, no XML library needed):
```js
const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i;
const linkRegex = /<link>([\s\S]*?)<\/link>/i;
const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;
const descRegex = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i;
```

**Fallback strategy — HTML scraping** (if RSS fails):

**Endpoint**: `GET https://github.blog/ai-and-ml/github-copilot/`

The blog listing page uses `<article class="...post-card">` blocks:
```html
<article class="d-flex flex-wrap gutter-spacious color-border-muted post-card">
    <h3 class="h4-mktg mb-3">
        <a href="/ai-and-ml/github-copilot/{slug}/" class="Link--primary post-card__link">
            {Title}
        </a>
    </h3>
    <div class="mb-2 f4-mktg color-fg-muted">
        <p>{Excerpt}</p>
    </div>
</article>
```

Parsing patterns:
```js
const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
const titleRegex = /<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[23]>/i;
const dateRegex = /<time[^>]*datetime="([^"]*)"[^>]*>/i;
const excerptRegex = /<p[^>]*class="[^"]*excerpt[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
```

**Second fallback** — broad link extraction:
```js
const linkRegex = /<a[^>]*href="(https:\/\/github\.blog\/[^"]*copilot[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
```
Filter: `title.length > 10`, deduplicate by URL.

**Output item schema**:
```json
{
    "id":      "blog-{url_slug}",
    "title":   "Run multiple agents at once with /fleet in Copilot CLI",
    "url":     "https://github.blog/ai-and-ml/github-copilot/{slug}/",
    "date":    "2026-04-02T12:00:00+00:00" | null,
    "excerpt": "Excerpt text..." | null
}
```

**ID generation**: Extract last non-empty path segment from URL.
```js
const slug = url.split("/").filter(Boolean).pop();
const id = `blog-${slug}`;
```

**Return envelope**: `{ "source": "blog", "count": N, "items": [...] }`

---

### 6.5 `copilot_news_fetch_reddit`

**Purpose**: Fetch recent posts from r/GithubCopilot.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_fetch_reddit`                                           |
| Description   | "Fetch recent posts from r/GithubCopilot subreddit. Returns post titles, scores, comment counts, and URLs." |

**Parameters schema**:
```json
{
    "type": "object",
    "properties": {
        "max_posts": {
            "type": "number",
            "description": "Maximum number of posts to return (default: 15)"
        },
        "sort": {
            "type": "string",
            "description": "Sort order: 'new' or 'hot' (default: 'new')",
            "enum": ["new", "hot"]
        }
    }
}
```

**API endpoint**: `GET https://www.reddit.com/r/GithubCopilot/{sort}.json?limit={max_posts}`

**Request headers**:
```
User-Agent: copilot-news-extension/1.0
```

Reddit REQUIRES a non-empty `User-Agent`. Without it, the request is blocked (429).

**Response structure** (Reddit Listing):
```json
{
    "kind": "Listing",
    "data": {
        "children": [
            {
                "kind": "t3",
                "data": {
                    "id": "1sb938g",
                    "title": "gpt 5.4 mini is EXTREMELY request efficient",
                    "permalink": "/r/GithubCopilot/comments/1sb938g/...",
                    "created": 1775209470.0,
                    "score": 5,
                    "num_comments": 12,
                    "link_flair_text": "General",
                    "selftext": "Post body...",
                    "author": "username"
                }
            }
        ]
    }
}
```

**Processing**:
1. Extract `data.children[].data`.
2. Compute cutoff = `cutoffDate(lookbackDays)` as Unix timestamp (seconds).
3. Filter: `post.created >= cutoff`.
4. Map to output schema:
   ```json
   {
       "id":          "reddit-{id}",
       "title":       "{title}",
       "url":         "https://www.reddit.com{permalink}",
       "date":        "{ISO 8601 from created * 1000}",
       "score":       5,
       "numComments": 12,
       "flair":       "General" | null,
       "selftext":    "{truncated to 500 chars}",
       "author":      "username"
   }
   ```

**Return envelope**: `{ "source": "reddit", "count": N, "items": [...] }`

**Error handling**:
- HTTP 429 (rate limit) → return `"Error: Reddit returned HTTP 429 — rate limited. Try again later."`
- HTTP 403 → return error (blocked by Reddit).

---

### 6.6 Docs Linking (via Skill)

Instead of fetching docs at runtime, the agent uses a **skill file** to map features
to documentation URLs. The skill file (`.github/skills/copilot-news.md`) is loaded
as persistent context via `skillDirectories`.

**Skill contents** — a reference table of topic areas to docs URLs:

| Topic area | Docs URL |
|------------|---------|
| CLI overview | https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli |
| CLI how-to | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli |
| MCP | https://docs.github.com/en/copilot/how-tos/context/model-context-protocol/using-mcp-tools-in-github-copilot-cli |
| Models | https://docs.github.com/en/copilot/using-github-copilot/ai-models-for-github-copilot |
| Agents | https://docs.github.com/en/copilot/concepts/agents/about-github-copilot-agents |
| What's new | https://docs.github.com/en/copilot/about-github-copilot/whats-new-in-github-copilot |
| General | https://docs.github.com/en/copilot |

**Agent prompt rule**: "For each feature, add a docs link using the copilot-news skill.
Format: `📖 [Docs](url)`."

---

### 6.7 `copilot_news_save_report`

**Purpose**: Save a markdown news report to the `reports/` directory.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_save_report`                                            |
| Description   | "Save a Copilot News markdown report to the reports/ directory with today's date." |

**Parameters schema**:
```json
{
    "type": "object",
    "properties": {
        "content": {
            "type": "string",
            "description": "The full markdown content of the news report"
        },
        "date": {
            "type": "string",
            "description": "Date for the report filename in YYYY-MM-DD format (default: today)"
        }
    },
    "required": ["content"]
}
```

**File naming**:
- Primary: `reports/{YYYY-MM-DD}.md`
- If file exists (same-day re-run): `reports/{YYYY-MM-DD}-2.md`, `-3.md`, etc.

**Handler behavior**:
1. Compute date: use `args.date` or `new Date().toISOString().split("T")[0]`.
2. Build path: `join(REPORTS_DIR, date + ".md")`.
3. If path exists, increment counter until a free filename is found.
4. Create `reports/` if it doesn't exist.
5. Write file with UTF-8 encoding.
6. Return: `"Report saved to reports/{filename}"` (relative path from repo root).

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

## 8. Agent Prompt (AGENT_PROMPT)

This string is the `prompt` field of the `CustomAgentConfig`. It is the agent's
system prompt and replaces the old `WORKFLOW_INSTRUCTIONS`.

```
You are the **Copilot News Agent** — a specialist for tracking GitHub Copilot CLI
developments.

## When the user starts a conversation or asks for news:

### Step 1 — Load state
Call `copilot_news_load_state`.

### Step 2 — Fetch sources (call ALL THREE in parallel)
- `copilot_news_fetch_releases`
- `copilot_news_fetch_blog`
- `copilot_news_fetch_reddit`

### Step 3 — Filter
- Skip items whose ID appears in `knownTopics`.
- Skip items whose title/body matches any string in `excludedKeywords`.
- Only include new features and capabilities. Bug fixes and performance improvements
  are already filtered at the source — do not re-introduce them.

### Step 4 — Add docs links
For every feature, add a relevant GitHub Copilot docs link using the knowledge
from the copilot-news skill. Format: `📖 [Docs](url)`.

### Step 5 — Save report
Call `copilot_news_save_report` with the full markdown (see report format in §7).

### Step 6 — Save state
Call `copilot_news_save_state` with `lastCheck` = now and all topic IDs from this
report merged into `knownTopics` (do NOT replace — append new IDs only).

### Step 7 — Present summary
Give a short, scannable terminal summary.

## Rules
- Never invent features — only report what you found in the fetched data.
- Always complete all steps, even if some sources return no results.
- If the user asks to exclude certain topics, call `copilot_news_save_state` with
  updated `excludedKeywords`.
```

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

## 10. Extension Lifecycle

### 10.1 Startup

```js
const session = await joinSession({
    skillDirectories: [SKILLS_DIR],
    customAgents: [{ name: "copilot-news", ... }],
    tools: TOOLS,
});

await session.log("📰 Copilot News Agent ready — run /agent to select 'Copilot News'");
```

The startup log message confirms the extension loaded successfully.

### 10.2 Reload

Extensions are reloaded when:
- `/clear` is executed.
- `extensions_reload()` is called programmatically.
- The CLI restarts.

All in-memory state is lost on reload. Persistent state lives in `data/state.json`.

### 10.3 Shutdown

Extensions receive SIGTERM on CLI exit. No cleanup is needed (state is saved
explicitly via the `save_state` tool, not on shutdown).

---

## 11. Preference Updates

There is no separate feedback loop or dedicated feedback tools. Preferences are
updated inline during any conversation:

- User says "exclude anything about streamer-mode" → agent calls `copilot_news_save_state`
  with the new keyword added to `excludedKeywords`.
- User says "focus on MCP and extensions next time" → agent calls `copilot_news_save_state`
  with updated `preferences.focusAreas`.

`copilot_news_save_state` handles both use cases (it accepts the full state).
The agent merges new values with existing state before saving.

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

- [ ] Extension loads without errors (`extensions_manage list` shows it)
- [ ] `extensions_manage inspect copilot-news` shows all 6 tools
- [ ] `/agent` command offers "Copilot News" in the selection list
- [ ] `copilot_news_load_state` returns valid JSON
- [ ] `copilot_news_fetch_releases` returns release data with bug fixes pre-filtered
- [ ] `copilot_news_fetch_blog` returns blog post data (via RSS)
- [ ] `copilot_news_fetch_reddit` returns Reddit posts
- [ ] `copilot_news_save_report` creates a file in `reports/`
- [ ] `copilot_news_save_state` persists changes to `data/state.json`
- [ ] Each feature in the report has a `📖 [Docs](url)` link
- [ ] Full workflow completes: load state → fetch (3 sources) → save report → save state → summary
- [ ] Same-day re-run creates `{date}-2.md` instead of overwriting
- [ ] State survives extension reload (JSON state persists in `data/state.json`)
- [ ] User can update exclusions inline: "exclude X" → agent calls save_state with new keyword

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
