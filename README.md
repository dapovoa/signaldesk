# SignalDesk

SignalDesk is a desktop assistant for live interview support.

It captures interviewer audio, transcribes speech, detects likely interview questions, and generates short suggested answers in real time.

## Requirements

- Node.js 22
- npm
- Linux, macOS, or Windows

## Development

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Linux:

```bash
npm run dev:linux
```

Typecheck:

```bash
npm run typecheck
```

## Build

Generic build:

```bash
npm run build
```

Platform builds:

```bash
npm run build:linux
npm run build:win
npm run build:mac
```

Artifacts are written to `dist/`.

## Providers

### Transcription providers

SignalDesk supports two transcription paths:

- `assemblyai`
- `openai`

#### AssemblyAI

- `transcriptionProvider = assemblyai`
- `transcriptionApiKey`
- `assemblyAiSpeechModel`
- `assemblyAiLanguageDetection`
- `assemblyAiMinTurnSilence`
- `assemblyAiMaxTurnSilence`
- `assemblyAiKeytermsPrompt`
- `assemblyAiPrompt`

#### OpenAI

- `transcriptionProvider = openai`
- `llmApiKey`

### LLM providers

SignalDesk supports three LLM provider modes:

- `openai`
- `openai-oauth`
- `openai-compatible`

#### openai

- `llmProvider = openai`
- `llmAuthMode = api-key` or `oauth-token`
- `llmApiKey`
- `llmModel`

#### openai-oauth

- `llmProvider = openai-oauth`
- `llmOauthToken`
- `llmOauthRefreshToken`
- `llmOauthExpiresAt`
- `llmOauthAccountId`
- `llmModel`

#### openai-compatible

- `llmProvider = openai-compatible`
- `llmBaseUrl`
- `llmApiKey`
- `llmCustomHeaders`
- `llmModel`

Example:
- `llmBaseUrl = https://api.deepseek.com`
- `llmModel = deepseek-chat`

## Configuration

Settings are stored in the app settings file under Electron `userData`.

On Linux this is typically:

```text
~/.config/signaldesk/settings.json
```

Environment variables are also supported as defaults for development.

Examples:

- `TRANSCRIPTION_PROVIDER`
- `ASSEMBLYAI_API_KEY`
- `LLM_PROVIDER`
- `LLM_AUTH_MODE`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`

## Debug Logging

By default, runtime logs are quiet.

To enable all verbose runtime logs:

```bash
SIGNALDESK_VERBOSE=1 npm run dev:linux
```

Granular flags are also supported:

```bash
SIGNALDESK_PIPELINE_VERBOSE=1
SIGNALDESK_OPENAI_VERBOSE=1
SIGNALDESK_AVATAR_VERBOSE=1
SIGNALDESK_ASSEMBLYAI_VERBOSE=1
```

## Project Structure

```text
src/main        Electron main process
src/preload     Preload bridge
src/renderer    React UI
resources       App icons and build assets
scripts         Utility scripts
```

## Notes

- On GNOME Wayland, always-on-top and opacity can be limited by the compositor.
