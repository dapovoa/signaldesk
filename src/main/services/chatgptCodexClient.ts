export interface ChatGPTCodexResponseRequest {
  accessToken: string
  accountId: string
  body: Record<string, unknown>
  baseURL?: string
}

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex'

const buildHeaders = (
  accessToken: string,
  accountId: string,
  stream: boolean
): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  'ChatGPT-Account-ID': accountId,
  'Content-Type': 'application/json',
  Accept: stream ? 'text/event-stream' : 'application/json'
})

const getErrorText = async (response: Response): Promise<string> => {
  const text = await response.text()
  return text.trim() || 'no body'
}

export const createChatGPTCodexResponse = async ({
  accessToken,
  accountId,
  body,
  baseURL = DEFAULT_BASE_URL
}: ChatGPTCodexResponseRequest): Promise<Response> => {
  const requestBody = { ...body, stream: true }
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    headers: buildHeaders(accessToken, accountId, true),
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    throw new Error(
      `ChatGPT Codex request failed (${response.status}): ${await getErrorText(response)}`
    )
  }

  return response
}

export async function* streamChatGPTCodexResponse(
  request: ChatGPTCodexResponseRequest
): AsyncGenerator<{ type?: string; delta?: string }, void, void> {
  const response = await createChatGPTCodexResponse(request)
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('ChatGPT Codex stream did not return a readable body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      const data = dataLines.join('\n')
      if (data && data !== '[DONE]') {
        try {
          yield JSON.parse(data) as { type?: string; delta?: string }
        } catch {
          // Ignore malformed chunks but keep the stream alive.
        }
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}
