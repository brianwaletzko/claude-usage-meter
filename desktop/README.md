# Claude Usage Meter (Windows desktop widget)

A small always-on-top window, like a sticky note in the corner of your screen, that shows how much of your Claude plan you've used. It shows both the **5-hour window** and the **weekly limit**, so you know when you're getting close.

- Each limit has a bar. It's green below 75%, amber from 75%, and red from 90%. Reset times are shown like "Resets 4:18 PM · in 2h 14m". Any model-specific weekly pools appear too.
- Drag it by its title bar to wherever you like. It remembers the spot next time.
- The taskbar shows the numbers too (e.g. "Claude 42% · 18%"), even when it's minimized.
- You get a Windows notification when either limit crosses 75% and 90%. You get each one once per window.
- Right-click it (or click **⋯**) for settings: Always on top, Check every, Alerts, Start with Windows, Renew sign-in, and Move to bottom-right corner.
- **✕** closes the app. Launch it again from the desktop or Start menu shortcut.

## Requirements

You need **Claude Code** installed and signed in with your Claude subscription. Run `claude` in a terminal once and sign in. The app reuses that sign-in from `%USERPROFILE%\.claude\.credentials.json`. It only reads that file and never changes it.

## How it works

Every 5 minutes (you can change this to 2, 10 or 15), the app asks `https://api.anthropic.com/api/oauth/usage` for your usage. This is the same internal endpoint the claude.ai usage page uses. Checking it does not count against your usage.

**This endpoint is undocumented.** Anthropic could change it at any time, and the app would show an error until it's updated.

### When the sign-in expires

Claude Code renews its own sign-in each time you use it. If you mostly use claude.ai and not Claude Code, the saved sign-in can expire. When that happens, the widget says so and offers **Renew sign-in**. That button runs a one-line Claude Code prompt on the cheapest model (`claude -p ok --model haiku --max-turns 1`) so Claude Code refreshes its sign-in. It uses a tiny amount of your plan. If you'd rather not click it each time, turn on **Auto-renew when expired** in the menu. Auto-renew runs at most once every 10 minutes.

## Install

Run `Claude-Usage-Meter-Setup-<version>.exe`. It adds a desktop shortcut and a Start menu entry. The app isn't code-signed, so Windows SmartScreen may warn you. Click **More info → Run anyway**. It installs for your user only, with no admin needed. To remove it, use **Settings → Apps**.

## Build from source

```
npm install
npm run icons        # needs Python 3 + Pillow; regenerates assets/
npm test
npm start            # run it locally
npm run dist:win     # build the installer into dist/
```
