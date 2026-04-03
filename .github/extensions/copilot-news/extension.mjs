import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Paths — resolved relative to the repo root (process.cwd())
// ---------------------------------------------------------------------------
const CWD = process.cwd();
const STATE_PATH = join(CWD, "data", "state.json");
const REPORTS_DIR = join(CWD, "reports");

// ---------------------------------------------------------------------------
// Helpers
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
// Keyword trigger patterns
// ---------------------------------------------------------------------------
const TRIGGER_PATTERNS = [
    /\bcopilot\s*news\b/i,
    /\bwhat'?s\s+new\b.*\bcopilot\b/i,
    /\bcopilot\b.*\bwhat'?s\s+new\b/i,
    /\bcheck\s+(copilot\s+)?updates?\b/i,
    /\bcopilot\s+updates?\b/i,
    /\bnews\s+check\b/i,
];

// ---------------------------------------------------------------------------
// Workflow instructions injected when trigger is detected
// ---------------------------------------------------------------------------
const WORKFLOW_INSTRUCTIONS = `
You have been triggered as the **Copilot News Agent**. Follow this workflow precisely:

## Step 1 — Load State
Call \`copilot_news_load_state\` to retrieve the user's known topics, excluded keywords, and preferences.

## Step 2 — Fetch Sources (in parallel)
Call ALL of these tools simultaneously:
- \`copilot_news_fetch_releases\`
- \`copilot_news_fetch_blog\`
- \`copilot_news_fetch_reddit\`
- \`copilot_news_fetch_docs\`

## Step 3 — Analyze & Filter
- Compare fetched items against \`knownTopics\` (by ID) — skip items the user already knows.
- Filter out items matching any \`excludedKeywords\`.
- Group remaining items by category: **New Features**, **Bug Fixes**, **Documentation**, **Community Highlights**.
- Rank by importance/impact.

## Step 4 — Generate Try-It-Out Suggestions
For each new feature or notable item, include a concrete **"Try it out"** suggestion:
- Exact CLI commands to run
- Example prompts to type
- Settings to change
- Links to relevant docs
Make these actionable — the user should be able to copy-paste and try immediately.

## Step 5 — Save Report
Call \`copilot_news_save_report\` with the full markdown report. Use this format:

\`\`\`
# Copilot CLI News — [DATE]

## 🆕 New Features
### [Feature Name] (source: [source])
[Summary]
**Try it out:** [concrete command/steps]

## 🐛 Bug Fixes
### [Fix Description] (source: [source])
[Summary]

## 📖 Documentation Updates
### [Doc Change] (source: [source])
[Summary]

## 💬 Community Highlights
### [Post Title] (source: reddit, score: [N])
[Summary]
**Try it out:** [if applicable]

## ℹ️ Excluded by Preference
[List of excluded keywords]
\`\`\`

## Step 6 — Present Summary
Show a concise terminal-friendly summary of the key findings. Keep it scannable.

## Step 7 — Collect Feedback
Use the \`ask_user\` tool to ask the user:
- Which topics they want to **mark as known** (so they won't appear next time)
- Which topics they want to **exclude permanently** (keywords to add to exclusion list)
- Any topics they want to learn **more** about
- Any **focus areas** to prioritize next time

## Step 8 — Save State
Based on user feedback, call \`copilot_news_save_state\` with the updated state:
- Add newly seen topic IDs to \`knownTopics\`
- Add any new excluded keywords
- Update \`lastCheck\` to now
- Update \`focusAreas\` if the user specified any

IMPORTANT: Complete ALL steps. Do not skip the feedback loop or state saving.
`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------
const session = await joinSession({
    // ------------------------------------------------------------------
    // Hook: detect trigger keywords and inject workflow
    // ------------------------------------------------------------------
    hooks: {
        onUserPromptSubmitted: async (input) => {
            const triggered = TRIGGER_PATTERNS.some((p) => p.test(input.prompt));
            if (triggered) {
                await session.log("📰 Copilot News Agent activated — fetching latest updates…");
                return { additionalContext: WORKFLOW_INSTRUCTIONS };
            }
        },
    },

    // ------------------------------------------------------------------
    // Custom tools
    // ------------------------------------------------------------------
    tools: [
        // ==============================================================
        // State management
        // ==============================================================
        {
            name: "copilot_news_load_state",
            description:
                "Load the Copilot News agent state: known topics, excluded keywords, preferences, and last check date.",
            parameters: { type: "object", properties: {} },
            handler: async () => {
                const state = loadState();
                return JSON.stringify(state, null, 2);
            },
        },
        {
            name: "copilot_news_save_state",
            description:
                "Save the updated Copilot News agent state. Provide the full state object including knownTopics, excludedKeywords, preferences, and lastCheck.",
            parameters: {
                type: "object",
                properties: {
                    lastCheck: {
                        type: "string",
                        description: "ISO 8601 timestamp of this check",
                    },
                    knownTopics: {
                        type: "array",
                        description:
                            "Array of known topic objects with id, title, date, source fields",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                title: { type: "string" },
                                date: { type: "string" },
                                source: { type: "string" },
                            },
                            required: ["id", "title", "source"],
                        },
                    },
                    excludedKeywords: {
                        type: "array",
                        description: "Array of keyword strings to permanently exclude",
                        items: { type: "string" },
                    },
                    preferences: {
                        type: "object",
                        description: "User preferences object",
                        properties: {
                            lookbackDays: { type: "number" },
                            focusAreas: {
                                type: "array",
                                items: { type: "string" },
                            },
                        },
                    },
                },
                required: ["lastCheck", "knownTopics", "excludedKeywords"],
            },
            handler: async (args) => {
                const current = loadState();
                const updated = {
                    lastCheck: args.lastCheck || new Date().toISOString(),
                    knownTopics: args.knownTopics || current.knownTopics,
                    excludedKeywords: args.excludedKeywords || current.excludedKeywords,
                    preferences: args.preferences || current.preferences,
                };
                saveState(updated);
                return `State saved. ${updated.knownTopics.length} known topics, ${updated.excludedKeywords.length} excluded keywords.`;
            },
        },

        // ==============================================================
        // Fetchers
        // ==============================================================
        {
            name: "copilot_news_fetch_releases",
            description:
                "Fetch recent GitHub Copilot CLI releases from the GitHub API. Returns structured release data including version, date, and release notes.",
            parameters: {
                type: "object",
                properties: {
                    max_releases: {
                        type: "number",
                        description: "Maximum number of releases to fetch (default: 15)",
                    },
                },
            },
            handler: async (args) => {
                const count = args.max_releases || 15;
                try {
                    const res = await fetch(
                        `https://api.github.com/repos/github/copilot-cli/releases?per_page=${count}`,
                        {
                            headers: {
                                Accept: "application/vnd.github+json",
                                "User-Agent": "copilot-news-extension",
                            },
                        }
                    );
                    if (!res.ok) return `Error: GitHub API returned HTTP ${res.status}`;
                    const releases = await res.json();
                    const state = loadState();
                    const cutoff = cutoffDate(state.preferences?.lookbackDays || 14);

                    const results = releases
                        .filter((r) => r.published_at >= cutoff)
                        .map((r) => ({
                            id: `release-${r.tag_name}`,
                            version: r.tag_name,
                            name: r.name,
                            date: r.published_at,
                            url: r.html_url,
                            body: (r.body || "").slice(0, 3000),
                            prerelease: r.prerelease,
                        }));

                    return JSON.stringify(
                        { source: "releases", count: results.length, items: results },
                        null,
                        2
                    );
                } catch (e) {
                    return `Error fetching releases: ${e.message}`;
                }
            },
        },

        {
            name: "copilot_news_fetch_blog",
            description:
                "Fetch recent GitHub Copilot blog posts from github.blog. Returns post titles, dates, summaries, and URLs.",
            parameters: {
                type: "object",
                properties: {
                    max_posts: {
                        type: "number",
                        description: "Maximum number of posts to return (default: 10)",
                    },
                },
            },
            handler: async (args) => {
                const maxPosts = args.max_posts || 10;
                const strip = (s) => s.replace(/<[^>]+>/g, "").trim();

                // --- Strategy 1: RSS feed (preferred — structured, reliable) ---
                try {
                    const rssRes = await fetch(
                        "https://github.blog/ai-and-ml/github-copilot/feed/",
                        { headers: { "User-Agent": "copilot-news-extension/1.0" } }
                    );
                    if (rssRes.ok) {
                        const xml = await rssRes.text();
                        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
                        const articles = [];
                        let m;
                        while ((m = itemRegex.exec(xml)) && articles.length < maxPosts) {
                            const block = m[1];
                            const t = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
                            const l = block.match(/<link>([\s\S]*?)<\/link>/i);
                            const d = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
                            const desc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
                            const title = strip(t ? (t[1] || t[2]) : "");
                            const url = l ? l[1].trim() : "";
                            if (title && url) {
                                articles.push({
                                    id: `blog-${url.split("/").filter(Boolean).pop() || title.slice(0, 30)}`,
                                    title,
                                    url,
                                    date: d ? new Date(d[1].trim()).toISOString() : null,
                                    excerpt: desc ? strip(desc[1] || desc[2]).slice(0, 300) : null,
                                });
                            }
                        }
                        if (articles.length > 0) {
                            return JSON.stringify({ source: "blog", count: articles.length, items: articles }, null, 2);
                        }
                    }
                } catch { /* fall through to HTML strategy */ }

                // --- Strategy 2: HTML scraping (fallback) ---
                try {
                    const res = await fetch(
                        "https://github.blog/ai-and-ml/github-copilot/",
                        { headers: { "User-Agent": "Mozilla/5.0 (compatible; copilot-news-extension/1.0)" } }
                    );
                    if (!res.ok) return `Error: Blog returned HTTP ${res.status}`;
                    const html = await res.text();
                    const articles = [];

                    // Try <article> blocks first
                    const articleBlocks = html.match(/<article[^>]*>[\s\S]*?<\/article>/gi) || [];
                    for (const block of articleBlocks.slice(0, maxPosts)) {
                        const titleMatch = block.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[23]>/i);
                        const dateMatch = block.match(/<time[^>]*datetime="([^"]*)"[^>]*>/i);
                        const excerptMatch = block.match(/<div[^>]*class="[^"]*f4-mktg[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                            || block.match(/<p[^>]*class="[^"]*excerpt[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
                        if (titleMatch) {
                            const title = strip(titleMatch[2]);
                            articles.push({
                                id: `blog-${titleMatch[1].split("/").filter(Boolean).pop() || title.slice(0, 30)}`,
                                title,
                                url: titleMatch[1].startsWith("http") ? titleMatch[1] : `https://github.blog${titleMatch[1]}`,
                                date: dateMatch ? dateMatch[1] : null,
                                excerpt: excerptMatch ? strip(excerptMatch[1]).slice(0, 300) : null,
                            });
                        }
                    }

                    // Broad link fallback
                    if (articles.length === 0) {
                        const linkRegex = /<a[^>]*href="(https:\/\/github\.blog\/[^"]*copilot[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
                        let lm;
                        const seen = new Set();
                        while ((lm = linkRegex.exec(html)) && articles.length < maxPosts) {
                            const url = lm[1], title = strip(lm[2]);
                            if (title.length > 10 && !seen.has(url)) {
                                seen.add(url);
                                articles.push({
                                    id: `blog-${url.split("/").filter(Boolean).pop()}`,
                                    title, url, date: null, excerpt: null,
                                });
                            }
                        }
                    }

                    return JSON.stringify({ source: "blog", count: articles.length, items: articles }, null, 2);
                } catch (e) {
                    return `Error fetching blog: ${e.message}`;
                }
            },
        },

        {
            name: "copilot_news_fetch_reddit",
            description:
                "Fetch recent posts from r/GithubCopilot subreddit. Returns post titles, scores, comment counts, and URLs.",
            parameters: {
                type: "object",
                properties: {
                    max_posts: {
                        type: "number",
                        description: "Maximum number of posts to return (default: 15)",
                    },
                    sort: {
                        type: "string",
                        description: "Sort order: 'new' or 'hot' (default: 'new')",
                        enum: ["new", "hot"],
                    },
                },
            },
            handler: async (args) => {
                const maxPosts = args.max_posts || 15;
                const sort = args.sort || "new";
                try {
                    const res = await fetch(
                        `https://www.reddit.com/r/GithubCopilot/${sort}.json?limit=${maxPosts}`,
                        {
                            headers: {
                                "User-Agent": "copilot-news-extension/1.0",
                            },
                        }
                    );
                    if (!res.ok) return `Error: Reddit returned HTTP ${res.status}`;
                    const data = await res.json();
                    const state = loadState();
                    const cutoff = new Date(cutoffDate(state.preferences?.lookbackDays || 14)).getTime() / 1000;

                    const posts = (data?.data?.children || [])
                        .map((c) => c.data)
                        .filter((p) => p.created >= cutoff)
                        .map((p) => ({
                            id: `reddit-${p.id}`,
                            title: p.title,
                            url: `https://www.reddit.com${p.permalink}`,
                            date: new Date(p.created * 1000).toISOString(),
                            score: p.score,
                            numComments: p.num_comments,
                            flair: p.link_flair_text || null,
                            selftext: (p.selftext || "").slice(0, 500),
                            author: p.author,
                        }));

                    return JSON.stringify(
                        { source: "reddit", count: posts.length, items: posts },
                        null,
                        2
                    );
                } catch (e) {
                    return `Error fetching Reddit: ${e.message}`;
                }
            },
        },

        {
            name: "copilot_news_fetch_docs",
            description:
                "Fetch the GitHub Copilot documentation page to check for recent updates and new content.",
            parameters: {
                type: "object",
                properties: {
                    section: {
                        type: "string",
                        description:
                            "Which docs section to check: 'main' for the overview, 'whats-new' for what's new (default: 'main')",
                        enum: ["main", "whats-new"],
                    },
                },
            },
            handler: async (args) => {
                const section = args.section || "main";
                const urls = {
                    main: "https://docs.github.com/en/copilot",
                    "whats-new": "https://docs.github.com/en/copilot/about-github-copilot/whats-new-in-github-copilot",
                };
                const url = urls[section] || urls.main;
                try {
                    const res = await fetch(url, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (compatible; copilot-news-extension/1.0)",
                        },
                    });
                    if (!res.ok) return `Error: Docs returned HTTP ${res.status}`;
                    const html = await res.text();

                    // Extract main content, stripping nav/header/footer
                    const mainMatch = html.match(
                        /<main[^>]*>([\s\S]*?)<\/main>/i
                    );
                    const content = mainMatch ? mainMatch[1] : html;

                    // Strip HTML tags, compress whitespace
                    const text = content
                        .replace(/<script[\s\S]*?<\/script>/gi, "")
                        .replace(/<style[\s\S]*?<\/style>/gi, "")
                        .replace(/<[^>]+>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 5000);

                    return JSON.stringify(
                        {
                            source: "docs",
                            section,
                            url,
                            content: text,
                        },
                        null,
                        2
                    );
                } catch (e) {
                    return `Error fetching docs: ${e.message}`;
                }
            },
        },

        // ==============================================================
        // Report saving
        // ==============================================================
        {
            name: "copilot_news_save_report",
            description:
                "Save a Copilot News markdown report to the reports/ directory with today's date.",
            parameters: {
                type: "object",
                properties: {
                    content: {
                        type: "string",
                        description: "The full markdown content of the news report",
                    },
                    date: {
                        type: "string",
                        description:
                            "Date for the report filename in YYYY-MM-DD format (default: today)",
                    },
                },
                required: ["content"],
            },
            handler: async (args) => {
                const date =
                    args.date || new Date().toISOString().split("T")[0];
                const filename = `${date}.md`;
                const filepath = join(REPORTS_DIR, filename);

                if (!existsSync(REPORTS_DIR))
                    mkdirSync(REPORTS_DIR, { recursive: true });

                // If a report already exists for today, append a counter
                let finalPath = filepath;
                if (existsSync(filepath)) {
                    let counter = 2;
                    while (existsSync(join(REPORTS_DIR, `${date}-${counter}.md`))) {
                        counter++;
                    }
                    finalPath = join(REPORTS_DIR, `${date}-${counter}.md`);
                }

                writeFileSync(finalPath, args.content, "utf-8");
                const relPath = finalPath.replace(CWD + (process.platform === "win32" ? "\\" : "/"), "");
                return `Report saved to ${relPath}`;
            },
        },
    ],
});

await session.log("📰 Copilot News extension loaded — type 'copilot news' to check for updates");
