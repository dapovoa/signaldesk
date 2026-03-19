import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { shell } from 'electron'

const AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`

export interface OpenAIOAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId: string
}

const toBase64Url = (buffer: Buffer): string =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const generatePkcePair = (): { verifier: string; challenge: string } => {
  const verifier = toBase64Url(randomBytes(32))
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

const generateState = (): string => toBase64Url(randomBytes(32))

const successPage = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OpenAI Connected</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b1220; color: #e5e7eb; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
      .card { max-width: 480px; padding: 24px; border: 1px solid #334155; border-radius: 12px; background: #111827; }
      h1 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 0; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>OpenAI sign-in completed</h1>
      <p>You can close this window and return to SignalDesk.</p>
    </div>
  </body>
</html>`

const errorPage = (message: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OpenAI Sign-in Failed</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b1220; color: #e5e7eb; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
      .card { max-width: 560px; padding: 24px; border: 1px solid #7f1d1d; border-radius: 12px; background: #111827; }
      h1 { margin: 0 0 12px; font-size: 20px; color: #fca5a5; }
      p { margin: 0; color: #fecaca; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>OpenAI sign-in failed</h1>
      <p>${message.replace(/[<&>]/g, '')}</p>
    </div>
  </body>
</html>`

interface RawOAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
}

interface OAuthIdTokenClaims {
  chatgpt_account_id?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

const parseJwtClaims = (token: string): OAuthIdTokenClaims => {
  const payload = token.split('.')[1]
  if (!payload) {
    throw new Error('OAuth token did not include a JWT payload')
  }

  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const json = Buffer.from(padded, 'base64').toString('utf8')
  return JSON.parse(json) as OAuthIdTokenClaims
}

const getAccountIdFromTokens = (idToken?: string, accessToken?: string): string => {
  const candidateTokens = [idToken, accessToken].filter(
    (token): token is string => Boolean(token?.trim())
  )

  for (const token of candidateTokens) {
    const claims = parseJwtClaims(token)
    const accountId =
      claims.chatgpt_account_id?.trim() ||
      claims['https://api.openai.com/auth']?.chatgpt_account_id?.trim()

    if (accountId) {
      return accountId
    }
  }

  throw new Error('OAuth tokens did not include chatgpt_account_id')
}

const resolveAccountIdFromTokens = (
  idToken: string | undefined,
  accessToken: string | undefined,
  previousAccountId = ''
): string => {
  try {
    return getAccountIdFromTokens(idToken, accessToken)
  } catch (error) {
    if (previousAccountId.trim()) {
      return previousAccountId
    }

    throw error
  }
}

const exchangeCodeForTokens = async (
  code: string,
  verifier: string,
  redirectUri: string
): Promise<OpenAIOAuthTokens> => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: verifier
  })

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${text}`)
  }

  const json = (await response.json()) as RawOAuthTokenResponse

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || '',
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    accountId: resolveAccountIdFromTokens(json.id_token, json.access_token)
  }
}

export const refreshOpenAIOAuthTokens = async (
  refreshToken: string,
  previousAccountId = ''
): Promise<OpenAIOAuthTokens> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${text}`)
  }

  const json = (await response.json()) as RawOAuthTokenResponse

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    accountId: resolveAccountIdFromTokens(json.id_token, json.access_token || undefined, previousAccountId)
  }
}

export const startOpenAIOAuthFlow = async (): Promise<OpenAIOAuthTokens> => {
  const { verifier, challenge } = generatePkcePair()
  const state = generateState()

  return new Promise<OpenAIOAuthTokens>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')

        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not found')
          return
        }

        const returnedState = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')

        if (error) {
          const message = `${error}${errorDescription ? `: ${errorDescription}` : ''}`
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(errorPage(message))
          server.close()
          reject(new Error(message))
          return
        }

        if (!code || !returnedState || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(errorPage('Invalid OAuth callback state.'))
          server.close()
          reject(new Error('Invalid OAuth callback state.'))
          return
        }

        const tokens = await exchangeCodeForTokens(code, verifier, REDIRECT_URI)

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(successPage)
        server.close()
        resolve(tokens)
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(errorPage(error instanceof Error ? error.message : 'OAuth sign-in failed.'))
        server.close()
        reject(error instanceof Error ? error : new Error('OAuth sign-in failed.'))
      }
    })

    server.listen(CALLBACK_PORT, '127.0.0.1', async () => {
      const authUrl = new URL(AUTH_URL)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
      authUrl.searchParams.set('scope', SCOPES)
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('id_token_add_organizations', 'true')
      authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
      authUrl.searchParams.set('originator', 'codex_cli')

      try {
        await shell.openExternal(authUrl.toString())
      } catch (error) {
        server.close()
        reject(error instanceof Error ? error : new Error('Failed to open browser for OAuth.'))
      }
    })

    server.on('error', (error) => {
      reject(error instanceof Error ? error : new Error('OAuth callback server failed to bind.'))
    })
  })
}

export { CHATGPT_CODEX_BASE_URL }
