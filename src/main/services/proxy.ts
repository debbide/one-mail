import { Socket, connect as connectTcp } from 'node:net'
import { TLSSocket, connect as connectTls, type ConnectionOptions } from 'node:tls'
import type { Session } from 'electron'
import http from 'node:http'
import { SocksClient } from 'socks'
import { getSettings } from '../db/repositories/settings.repository'

export type ProxyConfig = {
  protocol: 'none' | 'http' | 'socks5'
  host: string
  port: number
}

export function getProxyConfig(): ProxyConfig {
  const settings = getSettings()
  return {
    protocol: settings.proxyProtocol,
    host: settings.proxyHost,
    port: settings.proxyPort
  }
}

export function getProxyString(): string | undefined {
  const config = getProxyConfig()
  if (config.protocol === 'none' || !config.host || !config.port) {
    return undefined
  }
  return `${config.protocol}://${config.host}:${config.port}`
}

export function applyProxyToSession(session: Session): void {
  const proxyString = getProxyString()
  if (proxyString) {
    session.setProxy({ proxyRules: proxyString, proxyBypassRules: '<local>' }).catch((err) => {
      console.error('Failed to set proxy for session', err)
    })
  } else {
    session.setProxy({ proxyRules: '', proxyBypassRules: '' }).catch((err) => {
      console.error('Failed to clear proxy for session', err)
    })
  }
}

export async function connectTcpWithProxy(host: string, port: number): Promise<Socket> {
  const config = getProxyConfig()
  
  if (config.protocol === 'none') {
    return new Promise<Socket>((resolve, reject) => {
      const socket = connectTcp({ host, port })
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    })
  }

  if (config.protocol === 'socks5') {
    const info = await SocksClient.createConnection({
      proxy: {
        host: config.host,
        port: config.port,
        type: 5
      },
      command: 'connect',
      destination: {
        host,
        port
      }
    })
    return info.socket as Socket
  }

  if (config.protocol === 'http') {
    return new Promise<Socket>((resolve, reject) => {
      const req = http.request({
        method: 'CONNECT',
        host: config.host,
        port: config.port,
        path: `${host}:${port}`,
        headers: {
          Host: `${host}:${port}`
        }
      })

      req.on('connect', (res, socket) => {
        if (res.statusCode === 200) {
          resolve(socket as Socket)
        } else {
          reject(new Error(`HTTP Proxy CONNECT failed with status: ${res.statusCode}`))
        }
      })

      req.on('error', reject)
      req.end()
    })
  }

  throw new Error(`Unsupported proxy protocol: ${config.protocol}`)
}

export async function connectTlsWithProxy(host: string, port: number, options: Omit<ConnectionOptions, 'host' | 'port' | 'socket'>): Promise<TLSSocket> {
  const socket = await connectTcpWithProxy(host, port)
  
  return new Promise<TLSSocket>((resolve, reject) => {
    const tlsSocket = connectTls({
      ...options,
      socket,
      host,
      servername: host
    })
    tlsSocket.once('secureConnect', () => resolve(tlsSocket))
    tlsSocket.once('error', reject)
  })
}
