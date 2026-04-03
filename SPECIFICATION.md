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
| Output format          | Markdown report (saved) + terminal summary + `ask_user` feedback |
| Trigger mechanism      | `onUserPromptSubmitted` keyword hook                        |
| Changelog integration  | No (skip built-in `/changelog`)                             |
| Report history         | Yes — timestamped files in `reports/`                       |
| Try-it-out suggestions | Yes — every notable item gets an actionable suggestion      |
| State persistence      | JSON file in `data/state.json`                              |

---

## 2. File Structure

```
github-copilot-cli-explorer/
├── .github/
│   └── extensions/
│       └── copilot-news/
│           └── extension.mjs          ← Single-file extension (entry point)
├── data/
│   └── state.json                     ← Persisted agent state
├── reports/
│   ├── .gitkeep.md                    ← Ensures directory is tracked by git
│   ├── 2026-04-03.md                  ← Example report
│   └── 2026-04-10.md
└── README.md
```

- `extension.mjs` — MUST be named exactly this. Only `.mjs` is supported.
- `data/` and `reports/` are created automatically by tools if they don't exist.

---

## 3. Extension Architecture

### 3.1 High-Level Flow

```
User types: "copilot news"
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│  onUserPromptSubmitted Hook                                          │
│  1. Test prompt against TRIGGER_PATTERNS                             │
│  2. If match → log "📰 Copilot News Agent activated" (info)         │
│  3. Return { additionalContext: WORKFLOW_INSTRUCTIONS }              │
│  4. If no match → return undefined (no-op)                          │
└───────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│  LLM Agent (Copilot CLI) — guided by injected instructions          │
│                                                                       │
│  Step 1: Call copilot_news_load_state                                │
│  Step 2: Call all 4 fetchers IN PARALLEL:                            │
│          copilot_news_fetch_releases                                  │
│          copilot_news_fetch_blog                                      │
│          copilot_news_fetch_reddit                                    │
│          copilot_news_fetch_docs                                      │
│  Step 3: Analyze — compare against knownTopics (by ID), filter       │
│          excludedKeywords (case-insensitive substring match)          │
│  Step 4: For each new item → generate "Try it out" suggestion        │
│  Step 5: Call copilot_news_save_report with markdown report          │
│  Step 6: Call copilot_news_save_state (lastCheck + all topic IDs)    │
│  Step 7: Call copilot_news_request_feedback → ask in text response   │
│                                                                       │
│  [User replies with feedback → new turn]                              │
│                                                                       │
│  Step 8: Hook injects FEEDBACK_INSTRUCTIONS                          │
│  Step 9: Call copilot_news_update_preferences (keywords + focus)     │
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
const CWD        = process.cwd();                    // Repo root
const STATE_PATH = join(CWD, "data", "state.json");  // State file
const REPORTS_DIR = join(CWD, "reports");             // Report directory

let awaitingFeedback = false;  // Two-turn feedback flag (in-memory)
```

---

## 4. Trigger Hook

### 4.1 Keyword Patterns

The hook fires on `onUserPromptSubmitted`. The prompt is tested against an ordered
list of regex patterns. If **any** matches, the hook activates.

```js
const TRIGGER_PATTERNS = [
    /\bcopilot\s*news\b/i,
    /\bwhat'?s\s+new\b.*\bcopilot\b/i,
    /\bcopilot\b.*\bwhat'?s\s+new\b/i,
    /\bcheck\s+(copilot\s+)?updates?\b/i,
    /\bcopilot\s+updates?\b/i,
    /\bnews\s+check\b/i,
];
```

**Matching examples** (all case-insensitive):
- `"copilot news"` ✅
- `"Copilot News please"` ✅
- `"what's new in copilot"` ✅
- `"check copilot updates"` ✅
- `"copilot updates"` ✅
- `"news check"` ✅

**Non-matching examples**:
- `"tell me about copilot"` ❌
- `"update my dependencies"` ❌
- `"news about JavaScript"` ❌

### 4.2 Hook Behavior

```js
hooks: {
    onUserPromptSubmitted: async (input) => {
        const triggered = TRIGGER_PATTERNS.some((p) => p.test(input.prompt));
        if (!triggered) return;   // no-op — don't modify anything

        await session.log("📰 Copilot News Agent activated — fetching latest updates…");
        return { additionalContext: WORKFLOW_INSTRUCTIONS };
    },
}
```

- **`additionalContext`** is invisible to the user but visible to the LLM.
- The original prompt is NOT modified (`modifiedPrompt` is not returned).
- `session.log` uses default level `"info"`.

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

### 6.3 `copilot_news_request_feedback`

**Purpose**: Arm the two-turn feedback loop. Must be called after `copilot_news_save_state`
and before ending the news-check response.

| Property | Value |
|----------|-------|
| Name | `copilot_news_request_feedback` |
| Description | "Call this after presenting the news summary. Arms the system to capture the user's next reply as feedback. MUST be called before ending the response." |
| Parameters | `{ type: "object", properties: {} }` (no arguments) |
| Side effect | Sets in-memory `awaitingFeedback = true` |
| Returns | Confirmation string |

---

### 6.4 `copilot_news_update_preferences`

**Purpose**: Persist the user's feedback (excluded keywords, focus areas) after their reply.

| Property | Value |
|----------|-------|
| Name | `copilot_news_update_preferences` |
| Description | "Persist user feedback: add excluded keywords and/or update focus areas." |

**Parameters**:
```json
{
    "type": "object",
    "properties": {
        "excludedKeywords": { "type": "array", "items": { "type": "string" } },
        "focusAreas":       { "type": "array", "items": { "type": "string" } }
    }
}
```

**Handler behavior**:
1. Load current state.
2. Merge new `excludedKeywords` with existing (deduplicate via `Set`).
3. Replace `preferences.focusAreas` with provided value (or keep current if not provided).
4. Save. Return confirmation: `"Preferences saved — excluded: X | focus: Y"`.

---

### 6.5 `copilot_news_fetch_releases`

**Purpose**: Fetch recent Copilot CLI releases from the GitHub API.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_fetch_releases`                                         |
| Description   | "Fetch recent GitHub Copilot CLI releases from the GitHub API. Returns structured release data including version, date, and release notes." |

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
3. Filter: only releases where `published_at >= cutoff`.
4. Map each release to:
   ```json
   {
       "id":         "release-{tag_name}",
       "version":    "{tag_name}",
       "name":       "{name}",
       "date":       "{published_at}",
       "url":        "{html_url}",
       "body":       "{body truncated to 3000 chars}",
       "prerelease": true|false
   }
   ```
5. Return JSON envelope:
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

### 6.6 `copilot_news_fetch_blog`

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

### 6.7 `copilot_news_fetch_reddit`

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

### 6.8 `copilot_news_fetch_docs`

**Purpose**: Fetch the GitHub Copilot documentation to detect new/updated content.

| Property      | Value                                                                 |
|---------------|-----------------------------------------------------------------------|
| Name          | `copilot_news_fetch_docs`                                             |
| Description   | "Fetch the GitHub Copilot documentation page to check for recent updates and new content." |

**Parameters schema**:
```json
{
    "type": "object",
    "properties": {
        "section": {
            "type": "string",
            "description": "Which docs section to check: 'main' for the overview, 'whats-new' for what's new (default: 'main')",
            "enum": ["main", "whats-new"]
        }
    }
}
```

**URL mapping**:
```js
{
    "main":       "https://docs.github.com/en/copilot",
    "whats-new":  "https://docs.github.com/en/copilot/about-github-copilot/whats-new-in-github-copilot"
}
```

**Processing**:
1. Fetch the HTML page.
2. Extract `<main>` content: `/<main[^>]*>([\s\S]*?)<\/main>/i`.
3. Strip `<script>` and `<style>` blocks.
4. Strip all remaining HTML tags.
5. Compress whitespace.
6. Truncate to **5000 characters**.

**Return schema**:
```json
{
    "source":  "docs",
    "section": "main" | "whats-new",
    "url":     "https://docs.github.com/en/copilot",
    "content": "Plain text content (≤ 5000 chars)"
}
```

**Note**: The docs source is **unstructured** — it returns raw text. The LLM is
responsible for interpreting the content and identifying what's new based on
comparison with previously seen content. The docs tool is less structured than
the other sources but provides useful context the LLM can analyze.

---

### 6.9 `copilot_news_save_report`

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

The LLM generates this markdown. The format is specified in the injected
WORKFLOW_INSTRUCTIONS so the LLM follows it consistently.

```markdown
# Copilot CLI News — {YYYY-MM-DD}

> Last check: {previous lastCheck or "first run"}
> Sources: GitHub Releases, GitHub Blog, Reddit r/GithubCopilot, GitHub Docs
> Lookback: {N} days

---

## 🆕 New Features

### {Feature Name} (source: releases {version})
{1-3 sentence summary}

**Try it out:**
```
{exact CLI command or steps}
```

### {Feature Name} (source: blog)
{Summary}
**Link:** {url}

**Try it out:**
{Steps to try this feature}

---

## 🐛 Bug Fixes

### {Fix description} (source: releases {version})
{Brief description of what was fixed}

---

## 📖 Documentation Updates

### {What changed} (source: docs)
{Summary of documentation changes}

---

## 💬 Community Highlights

### {Post Title} (source: reddit, score: {N}, comments: {M})
{Summary of the discussion}
**Link:** {url}

**Try it out:** {if applicable — concrete suggestion}

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

**Sections with no items** should still appear with a note like
"No new items in this category."

---

## 8. Workflow Instructions (Injected Context)

This exact string is injected as `additionalContext` when the hook triggers.
It instructs the LLM on the complete workflow.

```
You have been triggered as the **Copilot News Agent**. Follow this workflow precisely:

## Step 1 — Load State
Call `copilot_news_load_state` to retrieve the user's known topics, excluded keywords,
and preferences.

## Step 2 — Fetch Sources (in parallel)
Call ALL of these tools simultaneously:
- `copilot_news_fetch_releases`
- `copilot_news_fetch_blog`
- `copilot_news_fetch_reddit`
- `copilot_news_fetch_docs`

## Step 3 — Analyze & Filter
- Compare fetched items against `knownTopics` (by ID) — skip items the user already knows.
- Filter out items matching any `excludedKeywords` (case-insensitive substring match
  against title, body, or excerpt).
- Group remaining items by category: **New Features**, **Bug Fixes**, **Documentation**,
  **Community Highlights**.
- Rank by importance/impact.

## Step 4 — Generate Try-It-Out Suggestions
For each new feature or notable item, include a concrete **"Try it out"** suggestion:
- Exact CLI commands to run
- Example prompts to type
- Settings to change
- Links to relevant docs
Make these actionable — the user should be able to copy-paste and try immediately.

## Step 5 — Save Report
Call `copilot_news_save_report` with the full markdown report. Use the report format
described in the specification: sections for New Features, Bug Fixes, Documentation,
Community Highlights, Excluded by Preference, and Statistics.

## Step 6 — Present Summary
Show a concise terminal-friendly summary of the key findings. Keep it scannable.
Use bullet points. Highlight the most impactful items.

## Step 7 — Collect Feedback
Use the `ask_user` tool to ask the user:
- Which topics they want to **mark as known** (so they won't appear next time)
- Which topics they want to **exclude permanently** (keywords to add to exclusion list)
- Any topics they want to learn **more** about (you'll provide deeper analysis)
- Any **focus areas** to prioritize next time

## Step 8 — Save State
Based on user feedback, call `copilot_news_save_state` with the updated state:
- Add ALL topic IDs that appeared in this report to `knownTopics`
  (merge with existing, don't replace)
- Add any new excluded keywords from user feedback
- Update `lastCheck` to the current ISO 8601 timestamp
- Update `focusAreas` if the user specified any

IMPORTANT: Complete ALL steps. Do not skip the feedback loop or state saving.
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
| Docs    | No known limit       | Single request per run                  |

If the extension is used as designed (every few days), rate limits are not a concern.

---

## 10. Extension Lifecycle

### 10.1 Startup

```js
const session = await joinSession({
    hooks: { ... },
    tools: [ ... ],
});

await session.log("📰 Copilot News extension loaded — type 'copilot news' to check for updates");
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

## 11. User Feedback Loop

### 11.1 Design

The feedback loop uses a **two-turn pattern** rather than the `ask_user` built-in
tool, which the LLM tends to skip after completing a multi-step workflow.

**Turn 1 (news check turn)**:
1. Agent completes Steps 1–6 (fetch, analyze, save report, save state).
2. Agent calls `copilot_news_request_feedback` → sets `awaitingFeedback = true`.
3. Agent asks feedback questions in its **text response** and ends the turn.

**Turn 2 (user feedback reply)**:
1. `onUserPromptSubmitted` detects `awaitingFeedback === true`.
2. Sets `awaitingFeedback = false` immediately (prevents double-trigger).
3. Injects `FEEDBACK_INSTRUCTIONS` as `additionalContext`.
4. Agent parses the user's reply, calls `copilot_news_update_preferences`.

### 11.2 State Saving Order

State is saved in **two separate calls**:

| Call | When | What |
|------|------|------|
| `copilot_news_save_state` | Step 6 of news turn | `lastCheck` + all report topic IDs → `knownTopics` |
| `copilot_news_update_preferences` | Feedback turn | New `excludedKeywords` + `focusAreas` |

Splitting the saves ensures progress is never lost — even if the user doesn't reply.

### 11.3 Feedback Questions (in agent's text)

```
> **Feedback (reply to any or all):**
> 1. Topics to **exclude forever** — keywords I should never show again?
> 2. **Focus areas** to prioritize next time (e.g. "extensions", "mcp", "models")?
> 3. Anything you want to explore deeper right now?
```

### 11.4 Tool: `copilot_news_request_feedback`

| Property | Value |
|----------|-------|
| Parameters | None |
| Side effect | Sets in-memory `awaitingFeedback = true` |
| Returns | Confirmation string for the LLM |

### 11.5 Tool: `copilot_news_update_preferences`

**Parameters**:
```json
{
    "type": "object",
    "properties": {
        "excludedKeywords": {
            "type": "array",
            "description": "New keywords to add to the permanent exclusion list",
            "items": { "type": "string" }
        },
        "focusAreas": {
            "type": "array",
            "description": "Topics to prioritize on the next news check",
            "items": { "type": "string" }
        }
    }
}
```

**Behavior**:
1. Load current state.
2. Merge new `excludedKeywords` with existing (deduplicate via `Set`).
3. Replace `preferences.focusAreas` with provided value.
4. Save. Return confirmation.

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
- [ ] `extensions_manage inspect copilot-news` shows all 9 tools
- [ ] Typing "copilot news" triggers the hook (log message "📰 Copilot News Agent activated" appears)
- [ ] `copilot_news_load_state` returns valid JSON
- [ ] `copilot_news_fetch_releases` returns release data
- [ ] `copilot_news_fetch_blog` returns blog post data (via RSS)
- [ ] `copilot_news_fetch_reddit` returns Reddit posts
- [ ] `copilot_news_fetch_docs` returns doc content
- [ ] `copilot_news_save_report` creates a file in `reports/`
- [ ] `copilot_news_save_state` persists changes to `data/state.json`
- [ ] `copilot_news_request_feedback` sets `awaitingFeedback = true`
- [ ] After feedback is requested, replying to the agent triggers "💬 Processing your feedback…" log
- [ ] `copilot_news_update_preferences` merges keywords and saves focus areas
- [ ] Full two-turn workflow completes: trigger → fetch → save → feedback question → reply → update prefs
- [ ] Same-day re-run creates `{date}-2.md` instead of overwriting
- [ ] Non-trigger prompts don't activate the hook
- [ ] State survives extension reload (`awaitingFeedback` resets, JSON state persists)

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
