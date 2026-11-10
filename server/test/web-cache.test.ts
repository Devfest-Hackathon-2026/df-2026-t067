import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createQuestHttpServer, send } from '../src/http-server'
import { serveTeamPreviewWeb } from '../src/team-preview-web'
import { listenServer } from './helpers'

for (const transport of ['request-listener', 'tcp'] as const) {
  test(`HTTP cache policy only makes hashed build assets immutable (${transport})`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'quest-web-cache-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(join(directory, 'assets'))
    for (const file of ['index.html', 'favicon.svg', 'assets/index-Ab12_-xy.js', 'assets/index-Ab12_-xy.css', 'assets/plain.js']) {
      await writeFile(join(directory, file), 'fixture')
    }
    const server = createQuestHttpServer('team-preview', async (request, response) => {
      if (await serveTeamPreviewWeb(directory, request, response, request.url!)) return
      send(response, request.url === '/assets/missing-Ab12_-xy.js' ? 404 : 200, {})
    })
    const connection = transport === 'tcp' ? await listenServer(t, server) : undefined
    // Also exercise the actual request listener without binding a restricted port.
    for (const method of ['GET', 'HEAD']) {
      for (const [path, expected] of [
        ['/assets/index-Ab12_-xy.js', 'public, max-age=31536000, immutable'],
        ['/assets/index-Ab12_-xy.css', 'public, max-age=31536000, immutable'],
        ['/', 'no-cache'], ['/admin', 'no-cache'], ['/terms', 'no-cache'], ['/terms/', 'no-cache'], ['/favicon.svg', 'no-cache'],
        ['/assets/plain.js', 'no-cache'],
        ['/api/v1/quests', 'private, no-store'],
        ['/api/v1/me/discoveries/one/photo', 'private, no-store'],
        ['/api/v1/admin/assets/one', 'private, no-store'],
        ['/assets/missing-Ab12_-xy.js', 'private, no-store'],
      ]) {
        if (connection) {
          const response = await fetch(connection.base + path, { method })
          assert.equal(response.headers.get('cache-control'), expected, `${method} ${path}`)
          await response.arrayBuffer()
          continue
        }
        const request = new IncomingMessage(new Socket())
        request.method = method
        request.url = path
        const response = new ServerResponse(request)
        await new Promise<void>((resolve) => {
          const end = response.end.bind(response)
          response.end = (() => { end(); resolve(); return response }) as typeof response.end
          server.emit('request', request, response)
        })
        assert.equal(response.getHeader('Cache-Control'), expected, `${method} ${path}`)
      }
    }
  })
}
