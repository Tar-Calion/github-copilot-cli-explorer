# GitHub Copilot CLI Explorer

A project for exploring and staying up-to-date with GitHub Copilot CLI.
Includes the **Copilot News Agent** — a Copilot CLI custom agent (extension) that
researches recent Copilot developments and delivers a curated, actionable digest.

---

## 🗞️ Copilot News Agent

### What it does

When you invoke the **Copilot News** agent, it:

1. **Fetches** from three sources in parallel:
   - GitHub Releases (`github/copilot-cli`) — **new features only** (bug fixes / perf improvements filtered out)
   - GitHub Blog (`github.blog/ai-and-ml/github-copilot/`) — via RSS, with HTML fallback
   - Reddit (`r/GithubCopilot`)
2. **Filters** out topics you've already seen and keywords you've excluded.
3. **Links** each feature to the relevant GitHub Copilot docs page.
4. **Suggests** a concrete "Try it out" action for every feature.
5. **Saves** a timestamped Markdown report to `reports/`.
6. **Persists** seen topics and preferences in `data/state.json` for the next run.

### How to invoke

Start Copilot CLI from the repo root:

```bash
cd github-copilot-cli-explorer
copilot
```

The extension loads and you'll see:

```
📰 Copilot News Agent ready — run /agent to select 'Copilot News'
```

Then switch to the agent:

```
/agent
```

Select **Copilot News** from the list, then start the conversation:

```
You: fetch recent Copilot news
```

The agent fetches the last 14 days of content and generates your first report.

---

## 📁 Repository structure

```
├── .github/
│   ├── extensions/
│   │   └── copilot-news/
│   │       └── extension.mjs   ← Copilot CLI custom agent (6 tools)
│   └── skills/
│       └── copilot-news.md     ← Skill: docs URL mapping for feature linking
├── data/
│   └── state.json              ← Persisted: known topics, excluded keywords, preferences
├── reports/
│   └── YYYY-MM-DD.md           ← Timestamped news reports (auto-generated)
├── SPECIFICATION.md            ← Full technical spec
└── README.md
```

---

## ⚙️ Configuration

Edit `data/state.json` directly, or ask the agent to update it during a conversation.

```json
{
  "lastCheck": null,
  "knownTopics": [],
  "excludedKeywords": ["streamer-mode", "enterprise-billing"],
  "preferences": {
    "lookbackDays": 14,
    "focusAreas": ["extensions", "mcp"]
  }
}
```

| Field | Description |
|-------|-------------|
| `lastCheck` | ISO timestamp of the last successful check |
| `knownTopics` | Topics already seen — filtered out on next run |
| `excludedKeywords` | Keywords permanently hidden |
| `preferences.lookbackDays` | How far back to look (default: 14) |
| `preferences.focusAreas` | Priority topics for the next check |

To update exclusions mid-conversation just tell the agent:

```
Exclude anything related to "streamer-mode" from now on
```

---

## 🛠️ Extension tools

| Tool | Purpose |
|------|---------|
| `copilot_news_load_state` | Load persisted state (known topics, preferences) |
| `copilot_news_save_state` | Save state after a run |
| `copilot_news_fetch_releases` | GitHub Releases API — new features only |
| `copilot_news_fetch_blog` | GitHub Blog (RSS → HTML fallback) |
| `copilot_news_fetch_reddit` | Reddit JSON API (`r/GithubCopilot`) |
| `copilot_news_save_report` | Write timestamped Markdown to `reports/` |

---

## 📄 Reports

Reports are saved to `reports/YYYY-MM-DD.md`. Example structure:

```markdown
# Copilot CLI News — 2026-04-10
> Sources: GitHub Releases · GitHub Blog · Reddit
> Lookback: 14 days

## 🆕 New Features
### Built-in skills (source: releases v1.0.18)
Skills are now bundled with the CLI — no separate install needed.
**Try it out:** type `/skills` to browse available skills.
📖 [Docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli)

## ✍️ Blog Posts
### What's new in GitHub Copilot — April 2026
Summary of the month's features…
**Read:** https://github.blog/…
📖 [Docs](https://docs.github.com/en/copilot/about-github-copilot/whats-new-in-github-copilot)

## 💬 Community Highlights
### "How I use Copilot CLI for daily standups" (score: 142)
Community workflow tips…
**Discussion:** https://www.reddit.com/r/GithubCopilot/…
```

---

## 📋 Specification

See [`SPECIFICATION.md`](./SPECIFICATION.md) for the full technical specification —
detailed enough to regenerate the entire application from scratch.
