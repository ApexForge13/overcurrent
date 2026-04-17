import { outlets } from '../src/data/outlets'
import { mapTier } from '../src/lib/outlet-map'

const check = ['infobae.com', 'elpais.com', 'theglobeandmail.com', 'asahi.com', 'balkaninsight.com', 'theconversation.com', 'nikkei.com', 'dawn.com', 'folha.uol.com.br']
for (const d of check) {
  const o = outlets.find(x => x.domain === d)
  if (o) console.log(`${d.padEnd(30)} tier=${mapTier(o)}`)
  else console.log(`${d.padEnd(30)} MISSING`)
}
