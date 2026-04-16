import { outlets } from '../src/data/outlets'
import * as fs from 'fs'

const seen = new Set<string>()
const deduped = outlets.filter(o => {
  const d = o.domain.toLowerCase()
  if (seen.has(d)) return false
  seen.add(d)
  return true
})

console.log('Before:', outlets.length, 'After:', deduped.length, 'Removed:', outlets.length - deduped.length)

const file = fs.readFileSync('src/data/outlets.ts', 'utf-8')
const marker = 'export const outlets: OutletInfo[] = ['
const beforeArray = file.substring(0, file.indexOf(marker) + marker.length)
// Find the closing ] of the outlets array — it's the one followed by a newline and then
// either DOMAIN_ALIASES or export function (not inside an object)
const arrayEndRegex = /\r?\n\]\r?\n/
const match = file.match(arrayEndRegex)
if (!match || match.index === undefined) { console.error('Could not find array end'); process.exit(1) }
const lastBracket = match.index + 1 // position of ]
const afterArray = file.substring(lastBracket)

const entries = deduped.map(o => {
  let s = '  {\n'
  s += `    name: ${JSON.stringify(o.name)},\n`
  s += `    domain: ${JSON.stringify(o.domain)},\n`
  s += `    country: ${JSON.stringify(o.country)},\n`
  s += `    region: ${JSON.stringify(o.region)},\n`
  s += `    type: ${JSON.stringify(o.type)},\n`
  s += `    politicalLean: ${JSON.stringify(o.politicalLean)},\n`
  s += `    reliability: ${JSON.stringify(o.reliability)},\n`
  s += `    language: ${JSON.stringify(o.language)},\n`
  if (o.rssUrl) s += `    rssUrl: ${JSON.stringify(o.rssUrl)},\n`
  s += '  },'
  return s
}).join('\n')

fs.writeFileSync('src/data/outlets.ts', beforeArray + '\n' + entries + '\n' + afterArray)
console.log('Written deduped file')
