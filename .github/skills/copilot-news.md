# Copilot News — Docs Reference

This skill gives the Copilot News Agent knowledge about GitHub Copilot documentation,
so it can link every reported feature directly to the relevant docs page.

## Docs URL Map

When reporting a feature, select the best matching docs link:

| Topic area | Docs URL |
|------------|---------|
| CLI overview / getting started | https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli |
| CLI how-to (using the CLI) | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli |
| Extensions & custom tools | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli#extensions |
| MCP (Model Context Protocol) | https://docs.github.com/en/copilot/how-tos/context/model-context-protocol/using-mcp-tools-in-github-copilot-cli |
| Models & model selection | https://docs.github.com/en/copilot/using-github-copilot/ai-models-for-github-copilot |
| Agents (cloud / coding agent) | https://docs.github.com/en/copilot/concepts/agents/about-github-copilot-agents |
| Skills | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli |
| Copilot in the IDE | https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-your-ide |
| Copilot Chat | https://docs.github.com/en/copilot/using-github-copilot/copilot-chat/using-github-copilot-chat-in-your-ide |
| Authentication / login | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli#authenticate-with-a-personal-access-token-pat |
| Plans & billing | https://github.com/features/copilot/plans |
| Copilot for organizations | https://docs.github.com/en/copilot/managing-copilot/managing-github-copilot-in-your-organization |
| What's new (general) | https://docs.github.com/en/copilot/about-github-copilot/whats-new-in-github-copilot |
| GitHub releases page | https://github.com/github/copilot-cli/releases |

## Linking Rules

1. **Always include a docs link** for each reported feature.
2. Match the feature's topic to the closest entry in the table above.
3. If no specific match exists, fall back to the "what's new" or "CLI how-to" URL.
4. Format as: `📖 [Docs](url)` inline after the feature summary.
