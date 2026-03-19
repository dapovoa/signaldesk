# SignalDesk

SignalDesk is a desktop assistant for live interview support.

It listens to interviewer audio, detects likely questions or prompts, and generates short suggested answers in real time. The app is built with Electron, React, TypeScript, and `electron-vite`.

## What it does

- Captures live interview audio from system output / loopback
- Transcribes speech using OpenAI or AssemblyAI
- Detects prompts and interview questions from transcript turns
- Generates suggested answers with OpenAI or ChatGPT OAuth/Codex-backed flows
- Stores local answer history
- Supports screenshot capture and question analysis

## Stack

- Electron
- React
- TypeScript
- Zustand
- Tailwind CSS
- `electron-builder`

## Requirements

- Node.js 22 recommended
- npm
- Linux, macOS, or Windows

Node 20 may still work for development, but some dependencies already expect Node 22+.

## Development

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

On Linux:

```bash
npm run dev:linux
```

Typecheck:

```bash
npm run typecheck
```

## Build

Generic production build:

```bash
npm run build
```

Platform packages:

```bash
npm run build:linux
npm run build:win
npm run build:mac
```

Linux packaging currently produces:

- `.AppImage`
- `.snap`
- `.deb`

Artifacts are written to:

```bash
dist/
```

## Configuration

Runtime settings are stored in Electron `userData`, not inside the project directory.

Configured credentials and tokens are managed through the in-app settings panel and stored locally by the app.

## Project Structure

```text
src/main        Electron main process
src/preload     Preload bridge
src/renderer    React UI
resources       App icons and build assets
scripts         Utility scripts
```

## Notes

- On GNOME Wayland, some window-management features such as always-on-top and opacity may be limited by the compositor.
- Dash/taskbar icon and window identity are more reliable in packaged builds than in `dev` mode.
