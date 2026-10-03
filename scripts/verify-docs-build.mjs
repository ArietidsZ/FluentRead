#!/usr/bin/env node
// Check the exact static artifact shipped to GitHub Pages, including legacy links.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseHTML } from 'linkedom'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'docs/.vitepress/dist')
const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const resolve = (href) => {
  const url = new URL(href, 'https://read.thinkstu.com')
  let name = decodeURIComponent(url.pathname)
  if (name.endsWith('/')) name += 'index.html'
  const exact = path.join(dist, name)
  return fs.existsSync(exact) && fs.statSync(exact).isFile()
    ? exact
    : fs.existsSync(exact + '.html')
    ? exact + '.html'
    : null
}
const docs = new Map(
  files(dist)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f, parseHTML(fs.readFileSync(f, 'utf8')).document])
)
const report = { pages: docs.size, links: 0, anchors: 0, images: 0 }
for (const [file, doc] of docs) {
  assert(doc.querySelector('h1') || file.endsWith('/404.html'), `Missing page title: ${file}`)
  if (file.endsWith('/404.html')) {
    assert(doc.querySelector('meta[name="robots"]')?.getAttribute('content') === 'noindex')
    assert(
      !doc.querySelector('link[rel="alternate"]'),
      '404 must not advertise missing translations'
    )
  } else {
    const route = path.relative(dist, file)
    const alternatePath = (route.startsWith('en/') ? route.slice(3) : 'en/' + route)
      .replace(/index\.html$/, '')
      .replace(/\.html$/, '')
    assert.equal(
      doc.querySelector('.bv-language')?.getAttribute('href'),
      '/' + alternatePath,
      `Language switch must preserve the page without a language-specific hash: ${route}`
    )
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
    assert(canonical?.startsWith('https://read.thinkstu.com/'), `Missing canonical: ${file}`)
    assert(resolve(canonical), `Missing canonical target: ${canonical}`)
    for (const alternate of doc.querySelectorAll('link[rel="alternate"][hreflang]')) {
      assert(resolve(alternate.getAttribute('href')), `Missing translated URL: ${file}`)
    }
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')
    if (!href.startsWith('/') && !href.startsWith('#')) continue
    if (href.startsWith('//')) continue
    const url = new URL(href, 'https://read.thinkstu.com/' + path.relative(dist, file))
    const target = resolve(url.href)
    assert(target, `Missing link ${href} in ${path.relative(dist, file)}`)
    report.links++
    if (url.hash && target.endsWith('.html')) {
      assert(
        docs.get(target)?.getElementById(decodeURIComponent(url.hash.slice(1))),
        `Missing anchor ${href} in ${path.relative(dist, file)}`
      )
      report.anchors++
    }
  }
  for (const img of doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src')
    if (!src.startsWith('/')) continue
    assert(resolve(src), `Missing image ${src}`)
    if (img.closest('.vp-doc,.bv-site'))
      assert(
        img.hasAttribute('width') && img.hasAttribute('height'),
        `Image needs dimensions: ${src}`
      )
    report.images++
  }
}
for (const file of files(path.join(root, 'docs/guide'))
  .concat(files(path.join(root, 'docs/config')))
  .filter((f) => f.endsWith('.md'))) {
  assert(
    fs.existsSync(path.join(root, 'docs/en', path.relative(path.join(root, 'docs'), file))),
    `Missing English equivalent: ${file}`
  )
}
for (const prefix of ['', '/en']) {
  const home = docs.get(resolve(prefix + '/'))
  assert(
    home.querySelector('.bv-home-brand img[src="/brand-icon.webp"]'),
    'Primary brand icon missing'
  )
  assert(!home.querySelector('.bv-hero [data-demo]'), 'Full demonstration belongs below the hero')
  assert(home.querySelector('.bv-home-header'), 'Homepage must use focused marketing navigation')
  assert(
    !home.querySelector('.bv-identity,.bv-platforms'),
    'Competing brand block and browser row must be removed'
  )
  assert(
    home.querySelector('.bv-translation-section [data-demo="brand-reader"]'),
    'Translation demo must appear below the hero'
  )
  assert(!home.querySelector('.bv-walkthrough'), 'Numbered walkthrough controls must be removed')
  assert.equal(home.querySelectorAll('.bv-hero h1').length, 1, 'Hero needs one primary headline')
  assert.equal(
    home.querySelectorAll('.bv-hero .bv-install-actions > a').length,
    1,
    'Hero needs one primary install action'
  )
  assert.equal(
    home.querySelectorAll('.bv-browser-options a').length,
    3,
    'Other browser installation options missing'
  )
  assert(
    [...home.querySelectorAll('[data-visual],[data-demo]')].every(
      (d) => d.getAttribute('data-playing') === 'true'
    ),
    'Homepage demonstrations must start automatically'
  )
  assert(
    home.querySelector('[data-demo="brand-reader"]') && home.querySelector('[data-demo="grammar"]'),
    'Homepage must contain readable SSR examples'
  )
  assert(
    home.querySelector(`a[href="${prefix}/docs/"]`),
    'Documentation must be reachable from the homepage'
  )
  const hub = docs.get(resolve(prefix + '/docs/'))
  assert(
    hub.querySelectorAll('.fr-docs-grid a').length === 4 &&
      hub.querySelectorAll('.fr-docs-links a').length >= 20,
    'Task guides missing from documentation hub'
  )
  assert(
    [...hub.querySelectorAll('.guide-details')].every((detail) => !detail.hasAttribute('open')),
    'Extra documentation topics must start collapsed'
  )
  assert(
    docs
      .get(resolve(prefix + '/config/translation-engines'))
      .querySelector('.vp-doc')
      .textContent.includes('{{apiKey}}'),
    'Provider placeholders must remain readable literal text'
  )
  const input = docs
    .get(resolve(prefix + '/guide/input-translation'))
    .querySelector('.vp-doc').textContent
  assert(input.includes('{{origin}}') && input.includes('{{to}}'), 'Prompt placeholders missing')
}
assert(
  !fs.existsSync(path.join(dist, 'maintainers')) && !fs.existsSync(path.join(dist, 'reports')),
  'Internal reports must stay out of the public website'
)
assert(fs.existsSync(path.join(dist, 'sitemap.xml')), 'Missing sitemap')
console.log(JSON.stringify({ ok: true, ...report }))
