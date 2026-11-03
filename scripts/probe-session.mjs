/**
 * 会话体检：解压 dsh 会话 jsonl.zstd，输出标题、消息数、公式规模与样例。
 * 用法：node /tmp/session-probe.mjs <session.v4.jsonl.zstd>
 */
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)

let text
try {
  text = zlib.zstdDecompressSync(buf).toString('utf8')
} catch (error) {
  console.error('解压失败:', String(error.message))
  process.exit(1)
}

const lines = text.split('\n').filter((line) => line.trim() !== '')
console.log('lines   :', lines.length)
console.log('bytes   :', text.length)

let title
let assistantText = ''
let userText = ''
const kinds = new Map()
const userMessages = []

for (const line of lines) {
  let evt
  try {
    evt = JSON.parse(line)
  } catch {
    continue
  }
  const kind = evt.type ?? evt.kind ?? 'unknown'
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1)

  const data = evt.data ?? evt
  if (title === undefined) {
    const candidate = data.title ?? data.session?.title ?? evt.title
    if (typeof candidate === 'string' && candidate !== '') title = candidate
  }
  if (kind === 'session') title = title ?? data.id

  const role = data.role ?? data.message?.role ?? evt.role
  const content = data.message?.content ?? data.content ?? data.text
  const parts = []
  if (typeof content === 'string') parts.push(content)
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') parts.push(part)
      else if (part && typeof part.text === 'string') parts.push(part.text)
    }
  }
  const text = parts.join('\n')
  if (text === '') continue
  if (kind === 'assistant/message' || role === 'assistant') assistantText += text + '\n'
  else if (kind === 'user/message' || role === 'user') {
    userText += text + '\n'
    if (userMessages.length < 6) userMessages.push(text.slice(0, 120).replace(/\s+/g, ' '))
  }
}

console.log('event kinds:', [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
console.log('title   :', JSON.stringify(title))
console.log('user msgs:')
for (const message of userMessages) console.log('  - ' + message)

const all = assistantText + '\n' + userText
const display = (all.match(/\$\$/g) ?? []).length / 2
const inline = (all.match(/\\\(/g) ?? []).length
const bracket = (all.match(/\\\[/g) ?? []).length
console.log('assistant chars:', assistantText.length, '| user chars:', userText.length)
console.log('$$ block:', Math.floor(display), '| \\( inline:', inline, '| \\[ block:', bracket)
console.log('total tex markers:', Math.floor(display) + inline + bracket)

const sample = assistantText.indexOf('$$')
if (sample >= 0) console.log('\n--- sample ---\n' + assistantText.slice(sample, sample + 400))
