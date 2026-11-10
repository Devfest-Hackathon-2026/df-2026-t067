import { expect, it } from 'vitest'
import { prepareRouteBoot } from './routeBoot'

function setup() {
  const body = document.createElement('body')
  body.className = 'explore-fullbleed other-class'
  const host = document.createElement('div')
  host.innerHTML = '<main>探索の初期画面</main>'
  body.append(host)
  return { body, host }
}

it.each(['/admin', '/admin-demo', '/admin-local', '/terms', '/terms/'])('clears explorer boot state before loading %s', pathname => {
  const { body, host } = setup()
  prepareRouteBoot(pathname, body, host)
  expect(body).not.toHaveClass('explore-fullbleed')
  expect(body).toHaveClass('other-class')
  expect(host).toBeEmptyDOMElement()
})

it.each(['/', '/?area=area-1', '/?quest=quest-1', '/?view=records'])('preserves explorer boot state for %s', url => {
  const { body, host } = setup()
  const shell = host.firstChild
  prepareRouteBoot(new URL(url, 'https://example.test').pathname, body, host)
  expect(body).toHaveClass('explore-fullbleed', 'other-class')
  expect(host.firstChild).toBe(shell)
})
