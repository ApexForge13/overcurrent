import { outlets } from '../src/data/outlets'

const priorityDomains = [
  // Wire services
  'apnews.com', 'reuters.com', 'afp.com',
  // US
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'bloomberg.com', 'npr.org', 'pbs.org',
  'cnn.com', 'foxnews.com', 'msnbc.com', 'nbcnews.com', 'cbsnews.com', 'abcnews.go.com',
  'cnbc.com', 'usatoday.com', 'latimes.com', 'chicagotribune.com', 'politico.com',
  'thehill.com', 'axios.com', 'forbes.com', 'newsweek.com', 'c-span.org',
  // Canada
  'cbc.ca', 'theglobeandmail.com',
  // UK
  'bbc.com', 'theguardian.com', 'ft.com', 'economist.com', 'thetimes.co.uk',
  'telegraph.co.uk', 'independent.co.uk', 'news.sky.com', 'dailymail.co.uk',
  // EU
  'dw.com', 'france24.com', 'euronews.com', 'politico.eu', 'spiegel.de',
  'sueddeutsche.de', 'faz.net', 'lemonde.fr', 'lefigaro.fr', 'elpais.com',
  'repubblica.it', 'nos.nl', 'kyivindependent.com', 'nzz.ch', 'meduza.io',
  // China/HK
  'scmp.com', 'cgtn.com', 'xinhuanet.com', 'globaltimes.cn', 'caixinglobal.com', 'sixthtone.com',
  // Taiwan
  'taipeitimes.com', 'focustaiwan.tw',
  // Japan
  'nhk.or.jp', 'japantimes.co.jp', 'asahi.com',
  // Korea
  'en.yna.co.kr', 'koreaherald.com',
  // India
  'thehindu.com', 'indianexpress.com', 'hindustantimes.com', 'ndtv.com',
  'timesofindia.com', 'thewire.in', 'wionews.com',
  // Pakistan/Bangladesh
  'dawn.com', 'geo.tv', 'thenews.com.pk', 'thedailystar.net',
  // SEA
  'channelnewsasia.com', 'straitstimes.com', 'rappler.com', 'bangkokpost.com',
  'thejakartapost.com', 'e.vnexpress.net', 'malaysiakini.com',
  // Australia
  'abc.net.au', 'smh.com.au',
  // Middle East
  'aljazeera.com', 'aljazeera.net', 'middleeasteye.net', 'al-monitor.com', 'aawsat.com',
  'arabnews.com', 'thenationalnews.com', 'timesofisrael.com', 'haaretz.com', 'jpost.com',
  'trtworld.com', 'hurriyetdailynews.com', 'iranintl.com', 'iranwire.com',
  'radiofarda.com', 'madamasr.com',
  // Africa
  'rfi.fr', 'jeuneafrique.com', 'mg.co.za', 'dailymaverick.co.za', 'news24.com',
  'premiumtimesng.com', 'punchng.com', 'theeastafrican.co.ke', 'nation.africa',
  'addisstandard.com', 'graphic.com.gh', 'africanews.com', 'allafrica.com', 'ahram.org.eg',
  // LatAm
  'folha.uol.com.br', 'oglobo.globo.com', 'clarin.com', 'infobae.com', 'lanacion.com.ar',
  'eluniversal.com.mx', 'jornada.com.mx', 'elespectador.com', 'latercera.com',
  'elcomercio.pe', 'efectococuyo.com', 'telesurenglish.net',
  // State/global
  'rt.com', 'tass.com', 'ria.ru', 'presstv.ir', 'tasnimnews.com', 'farsnews.ir',
  'voanews.com', 'rferl.org', 'rfa.org',
]

const existingDomains = new Set(outlets.map(o => o.domain.toLowerCase().replace(/^www\./, '')))
const existing: string[] = []
const missing: string[] = []

for (const d of priorityDomains) {
  const normalized = d.toLowerCase().replace(/^www\./, '')
  if (existingDomains.has(normalized)) existing.push(d)
  else missing.push(d)
}

console.log('\n━━━ PRIORITY OUTLET AUDIT ━━━\n')
console.log('Priority list total:', priorityDomains.length)
console.log('Already in registry:', existing.length)
console.log('Missing from registry:', missing.length)
console.log('\nTotal outlets in existing registry:', outlets.length)
console.log('\n── MISSING (need to add) ──')
missing.forEach(d => console.log('  -', d))
console.log('\n── ALREADY IN REGISTRY ──')
existing.forEach(d => console.log('  ✓', d))
