# usage-meter

A small Claude plugin that keeps your plan usage in view while you work:

- A status line under the prompt: `Usage · 5h: 42% (resets Sun 3:15 PM) · Week: 18% (resets Thu 9:00 AM)`
- A toast when the 5-hour or weekly window crosses 50%, 75% and 90% (re-arms when a new window starts)

The percentages are account-wide (the same figures Anthropic reports with each response), so usage from claude.ai and other sessions counts too. The line refreshes whenever Claude replies in the session. Reset times are shown in US Central time.

## Install

In a Claude Code terminal session:

```
/plugin install usage-meter --marketplace brianwaletzko/claude-usage-meter
```

Answer `y` to add the marketplace, then pick the **user** scope so it loads in every session.

## Develop

```
claude plugin validate .
claude plugin test .
```
