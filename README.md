# GitHub Copilot CLI Explorer

A project for exploring and staying up-to-date with GitHub Copilot CLI.
Includes the **Copilot News Agent** — a native Copilot CLI custom agent that
researches recent Copilot developments and delivers a curated, actionable digest.

---

## 🗞️ Copilot News Agent

### What it does

When you invoke the **Copilot News** agent, it:

1. **Fetches** from three sources using `curl`:
   - GitHub Releases (`github/copilot-cli`) — **new features only** (bug fixes and perf improvements filtered out)
   - GitHub Blog (`github.blog/ai-and-ml/github-copilot/`) via RSS feed
   - Reddit (`r/GithubCopilot`)
2. **Filters** out topics you have already seen and keywords you have excluded.
3. **Links** each feature to the relevant GitHub Copilot docs page (via a web search).
4. **Suggests** a concrete "Try it out" action for every feature.
5. **Saves** a timestamped Markdown report to `reports/`.
6. **Persists** seen topics and preferences in `data/state.md` for the next run.

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
  state.md                  <- Persisted: known topics, excluded keywords, preferences
reports/
  YYYY-MM-DD.md             <- Timestamped news reports (auto-generated)
README.md
```

---

## ⚙️ Configuration

State is stored in `data/state.md` as plain Markdown. Edit it directly or ask the agent to update it.

Example state file:

```markdown
# Copilot News State

Last checked: 2026-04-10

## Already reported
- release v1.0.17 — new features
- blog: Copilot in VS Code April update

## Excluded keywords
- streamer-mode
- enterprise-billing

## Preferences
- Lookback: 14 days
```

To update exclusions mid-conversation just tell the agent:

```
Exclude anything related to "streamer-mode" from now on
```

---

## 🛠️ How the agent works

The agent uses only **built-in Copilot CLI tools** -- no custom JavaScript:

| Built-in tool | Used for |
|---------------|---------|
| `shell` / `bash` | Fetching GitHub, Blog, Reddit APIs |
| `web_search` | Finding the relevant docs page for each feature |
| `view` | Reading `data/state.md` |
| `edit` | Updating `data/state.md` |
| `create` | Writing timestamped reports to `reports/` |

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

