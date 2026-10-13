# Claude Usage Meter

Keep an eye on your Claude plan limits without opening the usage page.

Claude plans have a **5-hour usage window** and a **weekly limit**. This project shows how much of each you've used, and when each one resets, in two ways:

- **Desktop widget (Windows):** a small always-on-top window that sits in a corner of your screen, like a sticky note.
- **Claude Code plugin:** a status line under the Claude Code prompt.

Use either one, or both.

<p align="center"><img src="docs/screenshot.png" alt="Claude Usage Meter desktop widget showing the 5-hour window at 9% and the weekly limit at 32%, with reset times" width="360"></p>

> **Unofficial.** This is a personal project. It is not made, endorsed, or supported by Anthropic. It relies on an undocumented endpoint that could change at any time (see [How it works](#how-it-works)).

---

## Desktop widget (Windows)

### Features

- Shows your **5-hour window** and **weekly limit** as bars, with the exact percentage and reset time ("Resets 4:18 PM · in 2h 14m"). Any model-specific weekly limits appear too.
- Colors change as you get closer: **green** below 75%, **amber** from 75%, **red** from 90%.
- **Stays on top** of other windows. Drag it anywhere, and it opens in the same spot next time.
- The **taskbar button shows the numbers** too (e.g. "Claude 42% · 18%"), even when it's minimized.
- **Windows notifications** when either limit crosses 75% and 90%, once per window.
- Refreshes every 5 minutes. You can change that to 2, 10, or 15.
- Optionally starts with Windows. It follows your light or dark theme.

### Install

1. Download `Claude-Usage-Meter-Setup-<version>.exe` from the [latest release](https://github.com/brianwaletzko/claude-usage-meter/releases/latest).
2. Run it. It installs for your user only, with no admin rights needed, and adds a desktop shortcut and a Start menu entry.
3. The app isn't code-signed, so Windows SmartScreen may show "Windows protected your PC". Click **More info → Run anyway**.

Prefer not to install anything? Download `Claude-Usage-Meter-Portable-<version>.exe` instead and run it directly.

To uninstall, go to **Settings → Apps → Installed apps → Claude Usage Meter**.

### Requirements

- Windows 10 or 11 (64-bit)
- A paid Claude subscription with usage limits (for example Pro or Max)
- **Claude Code** installed and signed in with that subscription. The widget reuses Claude Code's sign-in, so you never enter a password into it.

If you don't have Claude Code yet, open PowerShell and run:

```powershell
irm https://claude.ai/install.ps1 | iex
claude
```

Then sign in when prompted. You only need to do this once.

### Using it

| To… | Do this |
| --- | --- |
| Move it | Drag the title bar |
| Refresh now | Click **↻** |
| Change settings | Right-click anywhere, or click **⋯** |
| Hide it for a while | Click **–** (minimize) |
| Close it | Click **✕**, then reopen from the desktop or Start menu |

Settings include Always on top, Check every, Alert at 75% and 90%, Start with Windows, Auto-renew sign-in, and Move to bottom-right corner.

### Troubleshooting

**"Claude Code sign-in not found"**
The widget couldn't find `%USERPROFILE%\.claude\.credentials.json`. Run `claude` in a terminal and sign in. (The Claude desktop app and some editor extensions don't create this file. The command-line `claude` does.)

**"Your Claude Code sign-in has expired"**
Claude Code refreshes its sign-in whenever you use it. If you mostly use claude.ai instead, the saved sign-in can expire. Click **Renew sign-in**. That runs a one-word Claude Code prompt on the smallest model, which refreshes the sign-in and uses a tiny amount of your plan. To do this automatically, turn on **Auto-renew when expired** in the menu. It runs at most once every 10 minutes.

**"Signed in with an API key"**
Claude Code is using an Anthropic API key, not a Claude subscription. API keys don't have plan limits, so there's nothing to show.

**It shows an error after it was working**
Anthropic may have changed the usage endpoint. Check for a newer release, or [open an issue](https://github.com/brianwaletzko/claude-usage-meter/issues).

---

## Claude Code plugin

Shows your usage in Claude Code's status line:

```
Usage · 5h: 42% (resets Sun 3:15 PM) · Week: 18% (resets Thu 9:00 AM)
```

It also shows a notification when either limit crosses 50%, 75%, and 90%. The figures are account-wide, so usage on claude.ai and in other sessions counts too. The line updates whenever Claude replies. Reset times are currently shown in US Central time.

To install, run this in a Claude Code session:

```
/plugin install usage-meter --marketplace brianwaletzko/claude-usage-meter
```

Answer `y` to add the marketplace, then choose the **user** scope so it loads in every session.

---

## How it works

Both tools read the same usage numbers that claude.ai's **Settings → Usage** page shows. Checking them doesn't count against your plan.

The desktop widget:

- **Reads** the sign-in token that Claude Code saves on your computer. It **never changes, refreshes, or copies** that file, so it can't sign you out of Claude Code.
- Sends that token **only to `api.anthropic.com`**, to fetch your usage. It doesn't talk to any other server, and it has no analytics or tracking.
- Stores its settings (window position, refresh interval, alert history) in `%APPDATA%\Claude Usage Meter\config.json`.

The usage endpoint (`/api/oauth/usage`) is **undocumented**. Other community usage meters use it too, but Anthropic hasn't published it and could change or remove it without notice.

---

## Build from source

The desktop app is in [`desktop/`](desktop/). It's built with Electron, and you need a current LTS version of Node.js.

```powershell
cd desktop
npm install
npm test           # unit tests
npm start          # run it
npm run dist:win   # build the installer and portable .exe into desktop\dist\
```

The plugin is at the repository root ([`hooks/`](hooks/), [`.claude-plugin/`](.claude-plugin/)). To check it, run:

```
claude plugin validate .
claude plugin test .
```

## Contributing

Bug reports and suggestions are welcome in [Issues](https://github.com/brianwaletzko/claude-usage-meter/issues). If the widget stops working, please include the message it shows.

## License

[MIT](LICENSE) © 2026 Brian Waletzko
