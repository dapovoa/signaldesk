import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendWithinApproxTokenCap } from './streamTruncation'

test('returns unchanged response for empty chunk', () => {
  const result = appendWithinApproxTokenCap('hello', '', 10)

  assert.equal(result.nextResponse, 'hello')
  assert.equal(result.emittedChunk, '')
  assert.equal(result.reachedCap, false)
})

test('reports reachedCap when there is no remaining capacity', () => {
  const result = appendWithinApproxTokenCap('abcd', 'xyz', 1)

  assert.equal(result.nextResponse, 'abcd')
  assert.equal(result.emittedChunk, '')
  assert.equal(result.reachedCap, true)
})

test('appends full chunk when it fits in capacity', () => {
  const result = appendWithinApproxTokenCap('ab', 'cd', 1)

  assert.equal(result.nextResponse, 'abcd')
  assert.equal(result.emittedChunk, 'cd')
  assert.equal(result.reachedCap, false)
})

test('cuts chunk when it exceeds remaining capacity', () => {
  const result = appendWithinApproxTokenCap('abc', 'defgh', 1)

  assert.equal(result.nextResponse, 'abcd')
  assert.equal(result.emittedChunk, 'd')
  assert.equal(result.reachedCap, true)
})

test('multi-chunk accumulation reaches cap on later chunk', () => {
  const first = appendWithinApproxTokenCap('', 'ab', 1)
  const second = appendWithinApproxTokenCap(first.nextResponse, 'cdef', 1)

  assert.equal(first.nextResponse, 'ab')
  assert.equal(first.reachedCap, false)
  assert.equal(second.nextResponse, 'abcd')
  assert.equal(second.emittedChunk, 'cd')
  assert.equal(second.reachedCap, true)
})
