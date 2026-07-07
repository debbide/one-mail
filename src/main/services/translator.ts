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

export async function translateText(input: TranslateInput): Promise<TranslateResult> {
  const proxyConfig = getProxyConfig()
  let agent: http.Agent | https.Agent | undefined

  if (proxyConfig.protocol === 'socks5') {
    agent = new SocksProxyAgent(`socks5://${proxyConfig.host}:${proxyConfig.port}`)
  } else if (proxyConfig.protocol === 'http') {
    agent = new HttpsProxyAgent(`http://${proxyConfig.host}:${proxyConfig.port}`)
  }

  const targetLang = input.targetLang || 'zh-CN'
  
  // Use google translate free API
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.append('client', 'gtx')
  url.searchParams.append('sl', 'auto')
  url.searchParams.append('tl', targetLang)
  url.searchParams.append('dt', 't')
  url.searchParams.append('q', input.text)

  return new Promise<TranslateResult>((resolve, reject) => {
    const req = https.get(
      url.toString(),
      {
        agent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      },
      (res) => {
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
            // The free API returns nested arrays: [[[ "translated text", "original text" ], ...]]
            let translated = ''
            if (parsed && Array.isArray(parsed[0])) {
              for (const item of parsed[0]) {
                if (item[0]) {
                  translated += item[0]
                }
              }
            }
            resolve({ text: translated || input.text })
          } catch (e) {
            reject(new Error('Failed to parse translation response'))
          }
        })
      }
    )

    req.on('error', reject)
    req.end()
  })
}
