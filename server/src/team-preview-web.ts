import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { HttpError } from './errors'

const assetTypes: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

export async function serveTeamPreviewWeb(directory: string, request: IncomingMessage, response: ServerResponse, path: string) {
  const shell = path === '/' || path === '/admin'
  const asset = /^\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(path)?.[1]
  const contentType = shell ? 'text/html; charset=utf-8' : asset && assetTypes[extname(asset)]
  if (!contentType) return false
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
  }
  const filename = shell ? join(directory, 'index.html') : join(directory, 'assets', asset!)
  let bytes: Buffer
  try { bytes = await readFile(filename) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
  response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length })
  response.end(request.method === 'HEAD' ? undefined : bytes)
  return true
}
