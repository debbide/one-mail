import https from 'node:https'
import http from 'node:http'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyConfig } from './proxy'

export type TranslateInput = {
  text: string
  targetLang?: string // e.g. 'zh-CN', 'en'
}

export type TranslateResult = {
  text: string
}

async function translateChunk(
  text: string,
  targetLang: string,
  agent?: http.Agent | https.Agent
): Promise<string> {
  const params = new URLSearchParams()
  params.append('q', text)
  const postData = params.toString()

  return new Promise<string>((resolve, reject) => {
    const options = {
      hostname: 'translate.googleapis.com',
      path: `/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t`,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    }

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Translate API failed with status ${res.statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8')
          const parsed = JSON.parse(body)
          let translated = ''
          if (parsed && Array.isArray(parsed[0])) {
            for (const item of parsed[0]) {
              if (item[0]) {
                translated += item[0]
              }
            }
          }
          resolve(translated || text)
        } catch (e) {
          reject(new Error('Failed to parse translation response'))
        }
      })
    })

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

// Split HTML into chunks safely
function splitIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = []
  let current = text
  while (current.length > maxLen) {
    let splitIndex = current.lastIndexOf('</div>', maxLen)
    if (splitIndex === -1) splitIndex = current.lastIndexOf('</p>', maxLen)
    if (splitIndex === -1) splitIndex = current.lastIndexOf('<br>', maxLen)
    if (splitIndex === -1) splitIndex = current.lastIndexOf('\n', maxLen)
    if (splitIndex === -1) splitIndex = current.lastIndexOf('>', maxLen)
    if (splitIndex === -1) splitIndex = maxLen

    if (splitIndex !== maxLen && splitIndex !== -1) {
      if (current.substring(splitIndex).startsWith('</div>')) splitIndex += 6
      else if (current.substring(splitIndex).startsWith('</p>')) splitIndex += 4
      else if (current.substring(splitIndex).startsWith('<br>')) splitIndex += 4
      else if (current.substring(splitIndex).startsWith('>')) splitIndex += 1
    }

    chunks.push(current.slice(0, splitIndex))
    current = current.slice(splitIndex)
  }
  if (current) chunks.push(current)
  return chunks
}

export async function translateText(input: TranslateInput): Promise<TranslateResult> {
  const proxyConfig = getProxyConfig()
  let agent: http.Agent | https.Agent | undefined

  if (proxyConfig.protocol === 'socks5') {
    agent = new SocksProxyAgent(`socks5://${proxyConfig.host}:${proxyConfig.port}`)
  } else if (proxyConfig.protocol === 'http') {
    agent = new HttpsProxyAgent(`http://${proxyConfig.host}:${proxyConfig.port}`)
  }

  const targetLang = input.targetLang || 'zh-CN'
  const maxChunkSize = 4000
  const chunks = splitIntoChunks(input.text, maxChunkSize)

  let translatedFull = ''
  for (const chunk of chunks) {
    const res = await translateChunk(chunk, targetLang, agent)
    translatedFull += res
  }

  return { text: translatedFull }
}
