export const APPROX_CHARS_PER_TOKEN = 4

export interface StreamAppendResult {
  nextResponse: string
  emittedChunk: string
  reachedCap: boolean
}

export const appendWithinApproxTokenCap = (
  currentResponse: string,
  incomingChunk: string,
  maxTokens: number
): StreamAppendResult => {
  if (!incomingChunk) {
    return {
      nextResponse: currentResponse,
      emittedChunk: '',
      reachedCap: false
    }
  }

  const maxChars = Math.max(1, Math.floor(maxTokens * APPROX_CHARS_PER_TOKEN))
  const remainingChars = maxChars - currentResponse.length

  if (remainingChars <= 0) {
    return {
      nextResponse: currentResponse,
      emittedChunk: '',
      reachedCap: true
    }
  }

  if (incomingChunk.length <= remainingChars) {
    return {
      nextResponse: currentResponse + incomingChunk,
      emittedChunk: incomingChunk,
      reachedCap: false
    }
  }

  const cappedChunk = incomingChunk.slice(0, remainingChars)
  return {
    nextResponse: currentResponse + cappedChunk,
    emittedChunk: cappedChunk,
    reachedCap: true
  }
}
