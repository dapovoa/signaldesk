import * as fs from 'fs'

const API_KEY = process.env.MINIMAX_API_KEY || ''
const BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic'
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.7'

if (!API_KEY) {
  console.error('❌ Need MINIMAX_API_KEY environment variable')
  process.exit(1)
}

const CLASSIFIER_PROMPT = `You are a question classifier for a job interview assistant.

Given the interviewer turn, classify if the candidate should answer.

Output EXACTLY only this JSON format with no other text:
{"shouldAnswer": true/false, "questionType": "direct/indirect/scenario/none", "confidence": 0.0-1.0}

Examples:
- "Tell me about yourself" → {"shouldAnswer": true, "questionType": "direct", "confidence": 0.95}
- "What is your experience with React?" → {"shouldAnswer": true, "questionType": "direct", "confidence": 0.95}
- "I think this project is interesting" → {"shouldAnswer": false, "questionType": "none", "confidence": 0.9}
- "Thanks for joining" → {"shouldAnswer": false, "questionType": "none", "confidence": 0.95}`

const testQuestions = [
  'Tell me about yourself',
  'What is your greatest weakness?',
  'Why should we hire you?',
  'So can you walk me through your experience?',
  'Thanks for joining the call',
  'I like your CV'
]

async function testClassifier(question) {
  console.log(`\n📋 Testing: "${question}"`)
  console.log('─'.repeat(50))

  try {
    const response = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        temperature: 1,
        system: CLASSIFIER_PROMPT,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: `Interviewer turn:\n${question}` }]
          }
        ]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.log(`❌ HTTP ${response.status}: ${errorText}`)
      return
    }

    const data = await response.json()

    let rawOutput = ''
    const textBlock = data.content?.find(block => block.type === 'text')
    if (textBlock?.text) {
      rawOutput = textBlock.text
    } else {
      const thinkingBlock = data.content?.find(block => block.type === 'thinking')
      if (thinkingBlock?.text) {
        const jsonMatch = thinkingBlock.text.match(/\{[\s\S]*?"shouldAnswer"[\s\S]*?\}/)
        if (jsonMatch) {
          rawOutput = jsonMatch[0]
        }
      }
    }

    console.log('📝 Extracted:', rawOutput)

    try {
      const parsed = JSON.parse(rawOutput)
      console.log('✅ Parsed:', JSON.stringify(parsed))
    } catch (e) {
      console.log('❌ Parse error:', e.message)
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`)
  }
}

async function runTests() {
  console.log('🚀 Testing MiniMax Anthropic API')
  console.log(`   URL: ${BASE_URL}`)
  console.log(`   Model: ${MODEL}`)
  console.log(`   API Key: ${API_KEY.substring(0, 8)}...`)

  for (const question of testQuestions) {
    await testClassifier(question)
    await new Promise(r => setTimeout(r, 500))
  }

  console.log('\n✅ Tests completed')
}

runTests()