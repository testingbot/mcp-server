# Agent skills

One folder per task, each with a `SKILL.md` (YAML front matter `name` and `description`, then the steps). They are the same recipes the server offers as MCP prompts (`src/prompts.ts`), for agents that load skills from files rather than prompts.

| Skill | MCP prompt |
| --- | --- |
| `why-did-my-test-fail` | `why-did-my-test-fail` |
| `summarise-build` | `summarise-build` |
| `find-flaky-tests` | `find-flaky-tests` |

To use them with Claude Code, copy a folder into `.claude/skills/` in your project (or `~/.claude/skills/` for all projects). The TestingBot MCP server must be configured, since the steps call its tools and resources.

`tests/prompts-resources.test.ts` fails if a prompt has no skill folder, so keep the two in step.
