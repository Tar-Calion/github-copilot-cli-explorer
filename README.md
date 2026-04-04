# GitHub Copilot CLI Explorer

A project for exploring and staying up-to-date with GitHub Copilot CLI.
Includes the **Copilot News Agent** — a native Copilot CLI custom agent that
researches recent Copilot developments and delivers a curated, actionable digest.

---

## 🗞️ Copilot News Agent

### What it does

When you invoke the **Copilot News** agent, it:

1. **Fetches** from three sources:
   - GitHub Releases (`github/copilot-cli`) — **new features only** (bug fixes and perf improvements filtered out)
   - GitHub Blog (`github.blog/ai-and-ml/github-copilot/`) via RSS feed
   - Reddit (`r/GithubCopilot`)
2. **Filters** out topics you have already seen and keywords you have excluded.
3. **Links** each feature to the relevant GitHub Copilot docs page.
4. **Suggests** a concrete "Try it out" action for every feature.
5. **Saves** a timestamped Markdown report to `reports/`.
6. **Persists** seen topics and preferences in local `data/state.md` for the next run, using `data/state.md.template` as the committed starting point.

### How to invoke

Start Copilot CLI from the repo root:

```bash
cd github-copilot-cli-explorer
copilot
```

Then switch to the agent with the `/agent` slash command and select **Copilot News**,
or mention it directly in your prompt:

```
Use the copilot-news agent to fetch recent updates
```

Or launch directly:

```bash
copilot --agent=copilot-news --prompt "fetch recent Copilot news"
```

---

## 📁 Repository structure

```
.github/
  agents/
    copilot-news.agent.md   <- Agent profile (auto-discovered by CLI)
data/
  state.md.template         <- Committed starter file for local state
  state.md                  <- Local runtime state (gitignored)
reports/
  YYYY-MM-DD.md             <- Timestamped news reports (auto-generated)
README.md
```

---

## ⚙️ Configuration

Copy `data/state.md.template` to `data/state.md` if you want to seed it manually, or ask the agent to create and update `data/state.md` during a conversation.
`data/state.md` is gitignored. The file is free-form Markdown — just keep the headings so the agent can find things:

```markdown
# Agent State

## Last Check
2026-04-01T10:30:00Z

## Known Topics
- release-v1.0.17
- blog-copilot-extensions-ga

## Excluded Keywords
- streamer-mode
- enterprise-billing

## Preferences
- Lookback: 14 days
- Focus areas: extensions, mcp
```

To update exclusions mid-conversation just tell the agent:

```
Exclude anything related to "streamer-mode" from now on
```

---

## 🛠️ How the agent works

It fetches data from the three API endpoints, filters and enriches it, writes a
report to `reports/`, and updates local `data/state.md` so it knows what it has already seen.

---

## 📄 Reports

Reports are saved to `reports/YYYY-MM-DD.md`. Example:

```markdown
# Copilot CLI News -- 2026-04-10
> Sources: GitHub Releases · GitHub Blog · Reddit
> Lookback: 14 days

## 🆕 New Features
### Built-in skills (source: releases v1.0.18)
Skills are now bundled with the CLI -- no separate install needed.
**Try it out:** type `/skills` to browse available skills.
📖 [Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)

## 💬 Community Highlights
### "How I use Copilot CLI for daily standups" (score: 142)
Community workflow tips...
**Discussion:** https://www.reddit.com/r/GithubCopilot/...
```

