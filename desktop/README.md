# Claude Usage Meter: desktop widget source

This folder is the source for the Windows desktop widget. For what it does, how to install it, and troubleshooting, see the [main README](../README.md).

## Build and run

You need a current LTS version of Node.js.

```powershell
npm install
npm test             # unit tests (node --test)
npm start            # run it from source
npm run dist:win     # build the installer and portable .exe into dist\
npm run icons        # regenerate assets\ (needs Python 3 + Pillow)
```

If you start it from a VS Code or Claude Code terminal and it fails with `Cannot read properties of undefined`, clear `ELECTRON_RUN_AS_NODE` first: `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

Releases are built by GitHub Actions when a `v*` tag matching `package.json` is pushed (see [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml)).

## Layout

| Path | What it is |
| --- | --- |
| `src/main.js` | Electron main process: settings, polling, menu, window sizing, notifications, sign-in renewal |
| `src/usage.js` | Pure logic with no Electron, unit-tested: parsing, formatting, alerts, pace, backoff, source choice |
| `src/credentials.js` | Reads Claude Code's saved sign-in (read only) |
| `src/claudeai.js` | claude.ai sign-in window and usage requests, in a separate browser profile |
| `src/log.js` | The troubleshooting log (`meter.log`) |
| `src/popup.html`, `src/popup.js`, `src/preload.js` | The widget's UI and its bridge to the main process |
| `test/usage.test.js` | Unit tests |

## Testing hooks

These environment variables are for development only:

| Variable | Effect |
| --- | --- |
| `CUM_USER_DATA=<folder>` | Use a separate settings and sign-in folder, so a dev copy can run alongside the installed app |
| `CUM_USAGE_URL=<url>` | Read usage from a mock server instead of Anthropic (Claude Code sign-in path) |
| `CUM_SCREENSHOT=<file.png>` | Save a screenshot of the window after about 4 seconds, print the state and window size, then quit |
