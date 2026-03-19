#!/usr/bin/env node

import fs from 'node:fs'
import OpenAI from 'openai'

const env = process.env

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.join('=')]
  })
)

const parseHeaders = (raw) => {
  if (!raw || !raw.trim()) return undefined

  const headers = {}
  for (const item of raw.split(',')) {
    const entry = item.trim()
    if (!entry) continue
    const separator = entry.indexOf(':')
    if (separator <= 0) continue
    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()
    if (key && value) headers[key] = value
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

const apiKey = args.apiKey || env.KILO_CODE_API_KEY || env.OPENAI_COMPAT_API_KEY || env.OPENAI_API_KEY
const baseURL = args.baseURL || env.KILO_CODE_BASE_URL || env.OPENAI_COMPAT_BASE_URL || env.OPENAI_BASE_URL
const customHeaders = args.headers || env.KILO_CODE_HEADERS || env.OPENAI_COMPAT_HEADERS || env.OPENAI_CUSTOM_HEADERS
const chatModel = args.chatModel || env.TEST_CHAT_MODEL || env.OPENAI_MODEL
const sttModel = args.sttModel || env.TEST_STT_MODEL || env.STT_MODEL || 'whisper-1'
const audioFile = args.audio || env.TEST_AUDIO_FILE
const language = args.language || env.TEST_STT_LANGUAGE

if (!apiKey) {
  console.error('Missing API key. Set KILO_CODE_API_KEY, OPENAI_COMPAT_API_KEY or pass --apiKey=...')
  process.exit(1)
}

if (!baseURL) {
  console.error(
    'Missing base URL. Set KILO_CODE_BASE_URL, OPENAI_COMPAT_BASE_URL or pass --baseURL=...'
  )
  process.exit(1)
}

const client = new OpenAI({
  apiKey,
  baseURL,
  defaultHeaders: parseHeaders(customHeaders)
})

const printSection = (title) => {
  console.log(`\n=== ${title} ===`)
}

const isNotFound = (error) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('404') || message.toLowerCase().includes('not found')
}

const main = async () => {
  printSection('Provider')
  console.log(`Base URL: ${baseURL}`)
  console.log(`Custom headers: ${customHeaders ? 'yes' : 'no'}`)

  let listedModels = []

  printSection('Models')
  try {
    const response = await client.models.list()
    listedModels = response.data.map((model) => model.id).sort()
    console.log(`Count: ${listedModels.length}`)
    for (const model of listedModels) {
      console.log(model)
    }
  } catch (error) {
    console.error(`Model listing failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (chatModel) {
    printSection('Chat Probe')
    try {
      const response = await client.chat.completions.create({
        model: chatModel,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
        max_completion_tokens: 8,
        temperature: 0
      })

      const text = response.choices[0]?.message?.content || ''
      console.log(`Model: ${chatModel}`)
      console.log(`Response: ${JSON.stringify(text)}`)
    } catch (error) {
      console.error(`Chat probe failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  printSection('STT Capability')
  console.log(`Configured STT model: ${sttModel}`)
  console.log(
    'STT support requires both a compatible endpoint and a transcription-capable model. Model listing alone is not enough.'
  )

  if (!audioFile) {
    console.log('No audio probe executed. Pass --audio=/path/file.wav to test /audio/transcriptions directly.')
    return
  }

  if (!fs.existsSync(audioFile)) {
    console.error(`Audio file not found: ${audioFile}`)
    process.exit(1)
  }

  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioFile),
      model: sttModel,
      ...(language ? { language } : {})
    })

    console.log(`Transcription OK with model: ${sttModel}`)
    console.log(`Text: ${JSON.stringify(transcription.text || '')}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`STT probe failed: ${message}`)
    if (isNotFound(error)) {
      console.error('This usually means the provider does not expose the transcription endpoint at this base URL.')
    }
    process.exitCode = 2
  }
}

await main()
