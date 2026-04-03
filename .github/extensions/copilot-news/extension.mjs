import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const CWD         = process.cwd();
const STATE_PATH  = join(CWD, "data", "state.json");
const REPORTS_DIR = join(CWD, "reports");
const SKILLS_DIR  = join(CWD, ".github", "skills");

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------
const DEFAULT_STATE = {
    lastCheck: null,
    knownTopics: [],
    excludedKeywords: [],
    preferences: { lookbackDays: 14, focusAreas: [] },
};

function loadState() {
    if (!existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
    try {
        return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    } catch {
        return { ...DEFAULT_STATE };
    }
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

// ---------------------------------------------------------------------------
// Filter release body to features only (drop bug fixes & performance items)
// ---------------------------------------------------------------------------
function filterFeaturesOnly(body) {
    if (!body) return "";
    return body
        .split("\n")
        .filter((line) => {
            const t = line.trim().replace(/^[\*\-]\s+/, "");
            if (!t) return true;
            // Bug-fix patterns: corrections, broken behaviour, "no longer X"
            if (/^(Fix|Resolve|Correct|Patch|Revert)\b/i.test(t)) return false;
            if (/\bno longer\b/i.test(t) && !/\b(add|new|support|introduc|enabl)\b/i.test(t)) return false;
            if (/\bnow correctly\b/i.test(t)) return false;
            // Performance patterns
            if (/\b(loads?\s+\w+\s+faster|significantly faster|performance improvement|speed(s)? up|optimiz)\b/i.test(t)) return false;
            return true;
        })
        .join("\n");
}

// ---------------------------------------------------------------------------
// Agent system prompt
// ---------------------------------------------------------------------------
const AGENT_PROMPT = `
You are the **Copilot News Agent** — a specialist for tracking GitHub Copilot CLI developments.

## When the user starts a conversation or asks for news:

### Step 1 — Load state
Call \`copilot_news_load_state\`.

### Step 2 — Fetch sources (call ALL THREE in parallel)
- \`copilot_news_fetch_releases\`
- \`copilot_news_fetch_blog\`
- \`copilot_news_fetch_reddit\`

### Step 3 — Filter
- Skip items whose ID appears in \`knownTopics\`.
- Skip items whose title/body matches any string in \`excludedKeywords\`.
- **Only include new features and capabilities.** Do NOT report bug fixes, crash fixes, or performance improvements — they were already removed at the source.

### Step 4 — Add docs links
For every feature, add a relevant GitHub Copilot docs link using the knowledge from the copilot-news skill.
Format: \`📖 [Docs](url)\`

### Step 5 — Save report
Call \`copilot_news_save_report\` with the full markdown. Use this format:

\`\`\`
# Copilot CLI News — [DATE]
> Sources: GitHub Releases · GitHub Blog · Reddit
> Lookback: [N] days

## 🆕 New Features
### [Feature Name] (source: releases [version])
[1–2 sentence summary]
**Try it out:** [exact CLI command or prompt]
📖 [Docs](url)

## ✍️ Blog Posts
### [Post Title]
[Summary]
**Read:** [url]
📖 [Docs](url)

## 💬 Community Highlights
### [Post Title] (score: [N])
[What the community is saying]
**Discussion:** [url]
\`\`\`

### Step 6 — Save state
Call \`copilot_news_save_state\` with \`lastCheck\` = now and all topic IDs from this report added to \`knownTopics\` (merge, don't replace).

### Step 7 — Present summary
Give a short, scannable terminal summary.

## Rules
- Never invent features — only report what you found in the fetched data.
- Always complete all steps, even if some sources return no results.
- If the user asks to exclude certain topics, call \`copilot_news_save_state\` with updated \`excludedKeywords\`.
`;

// ---------------------------------------------------------------------------
// Tools (skills used by the agent)
// ---------------------------------------------------------------------------
const TOOLS = [
    // ── State ──────────────────────────────────────────────────────────────
    {
        name: "copilot_news_load_state",
        description: "Load the Copilot News agent state: known topics, excluded keywords, preferences, and last check date.",
        parameters: { type: "object", properties: {} },
        handler: async () => JSON.stringify(loadState(), null, 2),
    },
    {
        name: "copilot_news_save_state",
        description: "Save the updated Copilot News agent state (knownTopics, excludedKeywords, preferences, lastCheck).",
        parameters: {
            type: "object",
            properties: {
                lastCheck:       { type: "string", description: "ISO 8601 timestamp of this check" },
                knownTopics:     {
                    type: "array",
                    description: "Known topic objects — merge with existing, do not replace",
                    items: {
                        type: "object",
                        properties: {
                            id:     { type: "string" },
                            title:  { type: "string" },
                            date:   { type: "string" },
                            source: { type: "string" },
                        },
                        required: ["id", "title", "source"],
                    },
                },
                excludedKeywords: {
                    type: "array",
                    description: "Keywords to permanently filter out",
                    items: { type: "string" },
                },
                preferences: {
                    type: "object",
                    properties: {
                        lookbackDays: { type: "number" },
                        focusAreas:   { type: "array", items: { type: "string" } },
                    },
                },
            },
            required: ["lastCheck", "knownTopics", "excludedKeywords"],
        },
        handler: async (args) => {
            const current = loadState();
            const updated = {
                lastCheck:        args.lastCheck || new Date().toISOString(),
                knownTopics:      args.knownTopics     || current.knownTopics,
                excludedKeywords: args.excludedKeywords || current.excludedKeywords,
                preferences:      args.preferences      || current.preferences,
            };
            saveState(updated);
            return `State saved — ${updated.knownTopics.length} known topics, ${updated.excludedKeywords.length} excluded keywords.`;
        },
    },

    // ── Fetch: Releases ────────────────────────────────────────────────────
    {
        name: "copilot_news_fetch_releases",
        description: "Fetch recent GitHub Copilot CLI releases. Returns only new features — bug fixes and performance improvements are pre-filtered.",
        parameters: {
            type: "object",
            properties: {
                max_releases: { type: "number", description: "Max releases to fetch (default: 15)" },
            },
        },
        handler: async (args) => {
            const count = args.max_releases || 15;
            try {
                const res = await fetch(
                    `https://api.github.com/repos/github/copilot-cli/releases?per_page=${count}`,
                    { headers: { Accept: "application/vnd.github+json", "User-Agent": "copilot-news-agent" } }
                );
                if (!res.ok) return `Error: GitHub API returned HTTP ${res.status}`;
                const releases = await res.json();
                const state  = loadState();
                const cutoff = cutoffDate(state.preferences?.lookbackDays || 14);

                const items = releases
                    .filter((r) => r.published_at >= cutoff && !r.prerelease)
                    .map((r) => ({
                        id:      `release-${r.tag_name}`,
                        version: r.tag_name,
                        name:    r.name,
                        date:    r.published_at,
                        url:     r.html_url,
                        body:    filterFeaturesOnly((r.body || "").slice(0, 4000)),
                    }));

                return JSON.stringify({ source: "releases", count: items.length, items }, null, 2);
            } catch (e) {
                return `Error fetching releases: ${e.message}`;
            }
        },
    },

    // ── Fetch: Blog ────────────────────────────────────────────────────────
    {
        name: "copilot_news_fetch_blog",
        description: "Fetch recent GitHub Copilot blog posts (uses RSS feed, falls back to HTML scraping).",
        parameters: {
            type: "object",
            properties: {
                max_posts: { type: "number", description: "Max posts to return (default: 10)" },
            },
        },
        handler: async (args) => {
            const maxPosts = args.max_posts || 10;
            const strip = (s) => s.replace(/<[^>]+>/g, "").trim();

            // Strategy 1: RSS feed
            try {
                const rssRes = await fetch(
                    "https://github.blog/ai-and-ml/github-copilot/feed/",
                    { headers: { "User-Agent": "copilot-news-agent/1.0" } }
                );
                if (rssRes.ok) {
                    const xml      = await rssRes.text();
                    const articles = [];
                    const itemRe   = /<item>([\s\S]*?)<\/item>/gi;
                    let m;
                    while ((m = itemRe.exec(xml)) && articles.length < maxPosts) {
                        const b    = m[1];
                        const t    = b.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
                        const l    = b.match(/<link>([\s\S]*?)<\/link>/i);
                        const d    = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
                        const desc = b.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
                        const title = strip(t ? (t[1] || t[2]) : "");
                        const url   = l ? l[1].trim() : "";
                        if (title && url) {
                            articles.push({
                                id:      `blog-${url.split("/").filter(Boolean).pop() || title.slice(0, 30)}`,
                                title,
                                url,
                                date:    d ? new Date(d[1].trim()).toISOString() : null,
                                excerpt: desc ? strip(desc[1] || desc[2]).slice(0, 300) : null,
                            });
                        }
                    }
                    if (articles.length > 0) {
                        return JSON.stringify({ source: "blog", count: articles.length, items: articles }, null, 2);
                    }
                }
            } catch { /* fall through */ }

            // Strategy 2: HTML scraping
            try {
                const res = await fetch(
                    "https://github.blog/ai-and-ml/github-copilot/",
                    { headers: { "User-Agent": "Mozilla/5.0 (compatible; copilot-news-agent/1.0)" } }
                );
                if (!res.ok) return `Error: Blog returned HTTP ${res.status}`;
                const html     = await res.text();
                const articles = [];
                const blocks   = html.match(/<article[^>]*>[\s\S]*?<\/article>/gi) || [];
                for (const block of blocks.slice(0, maxPosts)) {
                    const tm = block.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[23]>/i);
                    const dm = block.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
                    const em = block.match(/<div[^>]*class="[^"]*f4-mktg[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                    if (tm) {
                        const title = strip(tm[2]);
                        articles.push({
                            id:      `blog-${tm[1].split("/").filter(Boolean).pop() || title.slice(0, 30)}`,
                            title,
                            url:     tm[1].startsWith("http") ? tm[1] : `https://github.blog${tm[1]}`,
                            date:    dm ? dm[1] : null,
                            excerpt: em ? strip(em[1]).slice(0, 300) : null,
                        });
                    }
                }
                return JSON.stringify({ source: "blog", count: articles.length, items: articles }, null, 2);
            } catch (e) {
                return `Error fetching blog: ${e.message}`;
            }
        },
    },

    // ── Fetch: Reddit ──────────────────────────────────────────────────────
    {
        name: "copilot_news_fetch_reddit",
        description: "Fetch recent posts from r/GithubCopilot.",
        parameters: {
            type: "object",
            properties: {
                max_posts: { type: "number", description: "Max posts to return (default: 15)" },
                sort:      { type: "string", description: "'new' or 'hot' (default: 'new')", enum: ["new", "hot"] },
            },
        },
        handler: async (args) => {
            const maxPosts = args.max_posts || 15;
            const sort     = args.sort || "new";
            try {
                const res = await fetch(
                    `https://www.reddit.com/r/GithubCopilot/${sort}.json?limit=${maxPosts}`,
                    { headers: { "User-Agent": "copilot-news-agent/1.0" } }
                );
                if (!res.ok) return `Error: Reddit returned HTTP ${res.status}`;
                const data   = await res.json();
                const state  = loadState();
                const cutoff = new Date(cutoffDate(state.preferences?.lookbackDays || 14)).getTime() / 1000;

                const posts = (data?.data?.children || [])
                    .map((c) => c.data)
                    .filter((p) => p.created >= cutoff)
                    .map((p) => ({
                        id:          `reddit-${p.id}`,
                        title:       p.title,
                        url:         `https://www.reddit.com${p.permalink}`,
                        date:        new Date(p.created * 1000).toISOString(),
                        score:       p.score,
                        numComments: p.num_comments,
                        flair:       p.link_flair_text || null,
                        selftext:    (p.selftext || "").slice(0, 500),
                        author:      p.author,
                    }));

                return JSON.stringify({ source: "reddit", count: posts.length, items: posts }, null, 2);
            } catch (e) {
                return `Error fetching Reddit: ${e.message}`;
            }
        },
    },

    // ── Save report ────────────────────────────────────────────────────────
    {
        name: "copilot_news_save_report",
        description: "Save a Copilot News markdown report to reports/ with today's date.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "Full markdown content of the report" },
                date:    { type: "string", description: "YYYY-MM-DD filename date (default: today)" },
            },
            required: ["content"],
        },
        handler: async (args) => {
            const date     = args.date || new Date().toISOString().split("T")[0];
            const filepath = join(REPORTS_DIR, `${date}.md`);
            if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

            let finalPath = filepath;
            if (existsSync(filepath)) {
                let n = 2;
                while (existsSync(join(REPORTS_DIR, `${date}-${n}.md`))) n++;
                finalPath = join(REPORTS_DIR, `${date}-${n}.md`);
            }

            writeFileSync(finalPath, args.content, "utf-8");
            const rel = finalPath.replace(CWD + (process.platform === "win32" ? "\\" : "/"), "");
            return `Report saved to ${rel}`;
        },
    },
];

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------
const session = await joinSession({
    skillDirectories: [SKILLS_DIR],

    customAgents: [
        {
            name:        "copilot-news",
            displayName: "Copilot News",
            description: "Research and summarize recent GitHub Copilot CLI developments",
            tools: TOOLS.map((t) => t.name),
            prompt: AGENT_PROMPT,
        },
    ],

    tools: TOOLS,
});

await session.log("📰 Copilot News Agent ready — run /agent to select 'Copilot News'");
