import { outlets } from '../src/data/outlets'

const check = ['nikkei.com', 'asia.nikkei.com', 'balkaninsight.com', 'theconversation.com', 'infobae.com', 'elpais.com', 'theglobeandmail.com', 'asahi.com', 'dawn.com']
const existing = new Set(outlets.map(o => o.domain.toLowerCase()))
for (const d of check) {
  console.log(existing.has(d) ? '✓ EXISTS' : '✗ MISSING', d)
}
