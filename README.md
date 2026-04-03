# GitHub Copilot CLI Explorer

A project for exploring and staying up-to-date with GitHub Copilot CLI.
Includes the **Copilot News Agent** — a Copilot CLI extension that researches
recent Copilot developments and delivers a curated, actionable digest.

---

## 🗞️ Copilot News Agent

### What it does

Every time you type **`copilot news`** in Copilot CLI, the agent:

1. **Fetches** from four sources in parallel:
   - GitHub Releases (`github/copilot-cli`)
   - GitHub Blog (`github.blog/ai-and-ml/github-copilot/`)
   - GitHub Docs (`docs.github.com/en/copilot`)
   - Reddit (`r/GithubCopilot`)
2. **Filters** out topics you've already seen and keywords you've excluded.
3. **Groups** findings: New Features · Bug Fixes · Documentation · Community.
4. **Suggests** a concrete "Try it out" action for every item.
5. **Saves** a timestamped Markdown report to `reports/`.
6. **Asks** for your feedback — keywords to exclude forever, topics to focus on next time.
7. **Persists** your preferences in `data/state.json` for the next run.

### Trigger phrases

| Phrase | Example |
|--------|---------|
| `copilot news` | "copilot news" |
| `copilot updates` | "any copilot updates?" |
| `what's new in copilot` | "what's new in copilot?" |
| `check copilot updates` | "check copilot updates" |
| `news check` | "news check" |

### Feedback loop

After the summary is shown, the agent asks:

> 1. Topics to **exclude forever** — keywords I should never show again?
> 2. **Focus areas** to prioritize next time (e.g. "extensions", "mcp", "models")?
> 3. Anything you want to **explore deeper** right now?

Your reply is automatically captured and saved to `data/state.json`.

---

## 📁 Repository structure

```
├── .github/
│   └── extensions/
│       └── copilot-news/
│           └── extension.mjs   ← Copilot CLI extension (9 tools + keyword hook)
├── data/
│   └── state.json              ← Persisted: known topics, excluded keywords, preferences
├── reports/
│   └── YYYY-MM-DD.md           ← Timestamped news reports (auto-generated)
├── SPECIFICATION.md            ← Full technical spec (regenerate from scratch)
└── README.md
```

---

## 🚀 Setup

### Prerequisites

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) installed and logged in
- An active GitHub Copilot subscription

### Install

```bash
git clone https://github.com/Tar-Calion/github-copilot-cli-explorer
cd github-copilot-cli-explorer
copilot
```

The extension loads automatically — you'll see:

```
📰 Copilot News extension loaded — type 'copilot news' to check for updates
```

### First run

```
You: copilot news
```

The agent fetches the last 14 days of content and generates your first report.

---

## ⚙️ Configuration

Edit `data/state.json` directly, or let the agent update it via the feedback loop.

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

---

## 🛠️ Extension tools

| Tool | Purpose |
|------|---------|
| `copilot_news_load_state` | Load persisted state |
| `copilot_news_save_state` | Save state after a run |
| `copilot_news_request_feedback` | Arm the feedback loop for the next user reply |
| `copilot_news_update_preferences` | Persist excluded keywords / focus areas |
| `copilot_news_fetch_releases` | GitHub Releases API |
| `copilot_news_fetch_blog` | GitHub Blog (RSS → HTML fallback) |
| `copilot_news_fetch_reddit` | Reddit JSON API |
| `copilot_news_fetch_docs` | GitHub Docs |
| `copilot_news_save_report` | Write timestamped Markdown to `reports/` |

---

## 📄 Reports

Reports are saved to `reports/YYYY-MM-DD.md`. Example structure:

```markdown
# Copilot CLI News — 2026-04-03

## 🆕 New Features
### Built-in skills (source: releases v1.0.17)
Skills are now included with the CLI…
**Try it out:** `/skills` to browse available skills.

## 🐛 Bug Fixes
…

## 💬 Community Highlights
…
```

---

## 📋 Specification

See [`SPECIFICATION.md`](./SPECIFICATION.md) for the full technical specification —
detailed enough to regenerate the entire application from scratch.
