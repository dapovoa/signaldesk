# SignalDesk

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red)](LICENSE) [![Version](https://img.shields.io/badge/version-0.0.4-blue)](package.json) [![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](README.md) [![Node.js](https://img.shields.io/badge/node.js-22-green)](README.md)

Desktop app for live interview support. Captures interviewer audio, transcribes speech, detects likely interview questions, and generates short answer suggestions in real time.

---

## Requirements

- Node.js 22
- npm
- Linux, macOS, or Windows
- For `GGUF Models`: `.gguf` files plus the local `llama.cpp` runtime in `~/.config/signaldesk/llama/bin`

---

## llama.cpp Binaries

Place `llama-server` in `~/.config/signaldesk/llama/bin/` (or the folder configured in Settings).

Alternatively, add `llama-server` to your system PATH.

---

## Install

```bash
npm install
```

---

## Run

```bash
npm run dev
```

Linux dev runner with quieter logs:

```bash
npm run dev:linux
```

Preview the production app locally:

```bash
npm start
```

---

## Development

### Typecheck

```bash
npm run typecheck
```

### Debug Flags

Enable verbose logging:

```bash
SIGNALDESK_VERBOSE=1 npm run dev:linux
```

---

## Build

Build app:

```bash
npm run build
```

Build Linux packages:

```bash
npm run build:linux
```

Build Linux release with explicit version:

```bash
npm run build:linux:release -- 0.0.4
```

Output goes to `dist/`.

- local Linux build example: `dist/signaldesk_amd64.deb`
- release Linux build example: `dist/signaldesk_0.0.4_amd64.deb`

---

## Debian

Install:

```bash
sudo dpkg -i dist/signaldesk_amd64.deb
```

Remove:

```bash
sudo dpkg -r signaldesk
```

---

## Default Paths on Linux

- settings: `~/.config/signaldesk/settings.json`
- avatar sources: `~/.config/signaldesk/avatar/sources`
- default GGUF models folder: `~/.config/signaldesk/models`
- llama.cpp runtime folder: `~/.config/signaldesk/llama/bin`

Required files in `~/.config/signaldesk/llama/bin`:

- `llama-server`
- `llama-cli`
- `libllama.so*`
- `libggml.so*`
- `libggml-base.so*`
- `libggml-cpu.so*`
- `libmtmd.so*`
- any extra shared libraries produced by your `llama.cpp` build

Notes:

- Avatar embedding models use the Avatar embedding folder picker.
- `GGUF Models` uses the folder selector beside `Answer Generation Model`.
- If you keep defaults, embeddings and GGUF generation models both resolve under `~/.config/signaldesk/models`.

---

## Settings Pickers

### Transcription

- `Transcription Provider`: `AssemblyAI` or `OpenAI`
- `AssemblyAI Speech Model`:
  - `Universal 3 Pro`
  - `Universal Streaming Multilingual`
  - `Universal Streaming English`
- `Language Detection`
- `Min Turn Silence`
- `Max Turn Silence`
- `Keyterms Prompt`
- `Streaming Prompt`

### LLM

- `LLM Provider`:
  - `OpenAI`
  - `OpenAI OAuth`
- `OpenAI Compatible`
- `Anthropic Compatible`
- `GGUF Models`
- `OpenAI Auth Mode`:
  - `API Key`
  - `OAuth Token`
- `Answer Generation Model`

For `GGUF Models`, the folder selector lives beside `Answer Generation Model`.

The `Answer Generation Model` picker follows the active `LLM Provider`.

---

## External Services

### AssemblyAI

- Dashboard: https://www.assemblyai.com/dashboard/code?product=streaming
- Docs: https://www.assemblyai.com/docs/streaming/universal-3-pro

---

## Project Layout

```
src/main        Electron main process
src/preload     Preload bridge
src/renderer    React UI
resources       App icons and build assets
scripts         Utility scripts
```

---

## License

This project is under the SignalDesk Proprietary License. See the [LICENSE](LICENSE) file for details.
