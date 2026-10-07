#!/usr/bin/env node
// Verify the Storybook subtree shipped with the documentation, including subpath-safe entry assets.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHTML } from 'linkedom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'docs/.vitepress/dist/storybook')
const index = JSON.parse(fs.readFileSync(path.join(dist, 'index.json'), 'utf8'))
const entries = Object.values(index.entries)
assert(index.entries['foundations-colors--docs']?.type === 'docs', 'The documentation entry link must resolve to the colors docs')
const titles = ['Overview/Introduction', 'Foundations/Colors', 'Foundations/Typography', 'Foundations/Surfaces', 'UI/Select', 'UI/FeatureEnableCard', 'UI/DownloadProgress', 'UI/ServiceIcon', 'UI/UiIcon', 'UI/TranslationLoading', 'UI/Controls', 'Examples/Settings']
for (const title of titles) {
  assert(entries.some((entry) => entry.title === title && entry.type === 'story'), `Missing stories: ${title}`)
  assert(entries.some((entry) => entry.title === title && entry.type === 'docs'), `Missing component documentation: ${title}`)
}
let assets = 0
for (const file of ['index.html', 'iframe.html']) {
  const document = parseHTML(fs.readFileSync(path.join(dist, file), 'utf8')).document
  for (const element of document.querySelectorAll('script[src],link[href]')) {
    const url = element.getAttribute('src') || element.getAttribute('href')
    if (!url || /^(?:https?:|data:|#)/.test(url)) continue
    assert(!url.startsWith('/'), `Asset must work under /storybook/: ${url}`)
    const target = path.resolve(dist, url.split(/[?#]/)[0])
    assert(target.startsWith(dist + path.sep) && fs.existsSync(target), `Missing entry asset: ${url}`)
    assets++
  }
}
console.log(JSON.stringify({ groups: titles.length, stories: entries.filter((entry) => entry.type === 'story').length, docs: entries.filter((entry) => entry.type === 'docs').length, assets }, null, 2))
