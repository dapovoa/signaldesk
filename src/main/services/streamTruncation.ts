export const APPROX_CHARS_PER_TOKEN = 4

export interface StreamAppendResult {
  nextResponse: string
  emittedChunk: string
  reachedCap: boolean
}

const trimChunkToBoundary = (chunk: string): string => {
  const boundaryRegex = /[\s,.!?;:)\]}]/
  let lastBoundaryIndex = -1

  for (let index = 0; index < chunk.length; index += 1) {
    if (boundaryRegex.test(chunk[index])) {
      lastBoundaryIndex = index
    }
  }

  if (lastBoundaryIndex <= 0) {
    return chunk
  }

  return chunk.slice(0, lastBoundaryIndex).trimEnd()
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
  const safeChunk = trimChunkToBoundary(cappedChunk)
  const emittedChunk = safeChunk || cappedChunk

  return {
    nextResponse: currentResponse + emittedChunk,
    emittedChunk,
    reachedCap: true
  }
}
