import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import nacl from 'tweetnacl'
import { compileInk } from '../src/lib/ink'
import { buildPack } from '../src/lib/pack'
import { getTheme } from '../src/lib/themes'

interface Demo {
  id: string
  title: string
  theme: string
  description: string
  source: string
  scene?: string
}

const demos: Demo[] = [
  {
    id: 'the-lantern-keepers',
    title: 'The Lantern Keepers',
    theme: 'noir',
    description: 'A short noir story about a bell under the harbour.',
    source: readFileSync('src/samples/story.ink', 'utf8'),
  },
  {
    id: 'the-clockwork-court',
    title: 'The Clockwork Court',
    theme: 'kingdom',
    description: 'A court that remembers every slight.',
    source: `# title: The Clockwork Court
# author: Knotebook

VAR favour = 0

-> start

=== start ===
# group: act1
# note: The court is a machine that remembers every slight.
The doors of the Clockwork Court open with a sound like a held breath.
* [Bow low] -> bow
* [Speak plainly] -> speak

=== bow ===
~ favour += 1
You bow until your forehead nearly touches the marble.
The chancellor's brass eyes whirr.
-> judgement

=== speak ===
You keep your voice level.
The chancellor's brass eyes whirr faster.
-> judgement

=== judgement ===
{ favour > 0: The court decides you know how to kneel. | The court decides you are dangerous. }
The chancellor raises one hand.
-> END
`,
  },
  {
    id: 'neon-rain',
    title: 'Neon Rain',
    theme: 'cyberpunk',
    description: 'A looping cyberpunk alley that always calls you back.',
    scene: 'rain',
    source: `# title: Neon Rain
# author: Knotebook

VAR signalStrength = 0

-> start

=== start ===
# group: act2
# note: A loop for testing: the signal always calls you back.
# image: assets/scene.svg
Rain falls upward in the alley behind the noodle bar.
* [Follow the signal] -> signal
* [Walk away] -> walk

=== signal ===
~ signalStrength += 1
The sign flickers: SAY MY NAME.
The alley folds back on itself.
-> start

=== walk ===
You walk until the rain is only weather again.
-> END
`,
  },
  {
    id: 'the-drowned-bell',
    title: 'The Drowned Bell',
    theme: 'nautical',
    description: 'A short nautical scene on a shingle beach.',
    source: `# title: The Drowned Bell
# author: Knotebook

-> shore

=== shore ===
# group: act1
# note: A short nautical scene.
The tide has left a bell half-buried in the shingle.
* [Dig it up] -> dig
* [Leave it] -> leave

=== dig ===
The bell is warm. It rings once, underwater.
-> END

=== leave ===
You walk on. Behind you, the bell rings once.
-> END
`,
  },
  {
    id: 'the-hollow-house',
    title: 'The Hollow House',
    theme: 'gothic',
    description: 'A house whose hall is longer than the house.',
    source: `# title: The Hollow House
# author: Knotebook

VAR doorOpen = false

-> hall

=== hall ===
# group: act1
The hall is longer than the house.
* [Open the door] -> door
* [Climb the stairs] -> stairs

=== door ===
~ doorOpen = true
The door opens onto the same hall.
-> hall

=== stairs ===
The stairs go up and arrive at the hall.
-> hall
`,
  },
  {
    id: 'signal-from-europa',
    title: 'Signal from Europa',
    theme: 'space',
    description: 'A repeating signal under the ice.',
    source: `# title: Signal from Europa
# author: Knotebook

VAR trust = 0

-> bridge

=== bridge ===
# group: act1
The signal repeats every eleven seconds.
* [Answer] -> answer
* [Log it and wait] -> wait

=== answer ===
~ trust += 1
The signal answers in your own voice.
-> END

=== wait ===
The signal stops.
-> END
`,
  },
]

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function artwork(id: string, accent: string): string {
  switch (id) {
    case 'the-lantern-keepers':
      return `
<circle cx="470" cy="78" r="44" fill="${accent}" opacity="0.18"/>
<circle cx="470" cy="78" r="25" fill="${accent}" opacity="0.45"/>
<path d="M0 250 Q150 228 300 250 T600 250 V360 H0Z" fill="${accent}" opacity="0.08"/>
<path d="M0 282 Q150 260 300 282 T600 282" fill="none" stroke="${accent}" stroke-width="2" opacity="0.3"/>
<rect x="105" y="170" width="58" height="82" rx="7" fill="#101117" stroke="${accent}" stroke-width="3"/>
<rect x="118" y="188" width="32" height="46" fill="${accent}" opacity="0.5"/>
<circle cx="134" cy="211" r="26" fill="${accent}" opacity="0.10"/>
`
    case 'the-clockwork-court':
      return `
<circle cx="130" cy="110" r="46" fill="none" stroke="${accent}" stroke-width="5" opacity="0.8"/>
<circle cx="130" cy="110" r="18" fill="${accent}" opacity="0.5"/>
<circle cx="470" cy="140" r="34" fill="none" stroke="${accent}" stroke-width="4" opacity="0.6"/>
<circle cx="470" cy="140" r="12" fill="${accent}" opacity="0.4"/>
<path d="M240 250 V160 H280 V250 M320 250 V120 H360 V250 M400 250 V180 H440 V250" fill="${accent}" opacity="0.18" stroke="${accent}" stroke-width="2"/>
<path d="M0 250 H600" stroke="${accent}" stroke-width="2" opacity="0.5"/>
`
    case 'neon-rain':
      return `
<path d="M0 250 V150 H60 V250 M80 250 V110 H140 V250 M160 250 V170 H210 V250 M230 250 V90 H300 V250 M320 250 V140 H380 V250 M400 250 V120 H470 V250 M490 250 V170 H550 V250 M570 250 V140 H600 V250" fill="${accent}" opacity="0.14"/>
<path d="M70 130 H120 M250 80 H290 M410 130 H460" stroke="${accent}" stroke-width="4" opacity="0.6"/>
<g stroke="${accent}" stroke-width="1.5" opacity="0.35">
<path d="M60 40 L30 120 M140 20 L110 100 M220 40 L190 120 M300 20 L270 100 M380 40 L350 120 M460 20 L430 100 M540 40 L510 120"/>
</g>
`
    case 'the-drowned-bell':
      return `
<path d="M0 230 Q80 200 160 230 T320 230 T480 230 T600 230 V360 H0Z" fill="${accent}" opacity="0.12"/>
<path d="M0 265 Q80 235 160 265 T320 265 T480 265 T600 265" fill="none" stroke="${accent}" stroke-width="3" opacity="0.35"/>
<path d="M300 120 Q340 160 340 205 H260 Q260 160 300 120Z" fill="${accent}" opacity="0.4" stroke="${accent}" stroke-width="3"/>
<circle cx="300" cy="220" r="8" fill="${accent}" opacity="0.7"/>
`
    case 'the-hollow-house':
      return `
<path d="M150 250 V140 L300 60 L450 140 V250Z" fill="${accent}" opacity="0.14" stroke="${accent}" stroke-width="3"/>
<rect x="210" y="165" width="42" height="48" fill="${accent}" opacity="0.35"/>
<rect x="348" y="165" width="42" height="48" fill="${accent}" opacity="0.35"/>
<rect x="280" y="195" width="40" height="55" fill="#101117" stroke="${accent}" stroke-width="2"/>
<path d="M300 60 V40" stroke="${accent}" stroke-width="3"/>
`
    case 'signal-from-europa':
      return `
<circle cx="420" cy="130" r="86" fill="${accent}" opacity="0.16"/>
<circle cx="420" cy="130" r="86" fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/>
<path d="M350 100 L390 120 L370 150 L420 170 L450 140 L490 155" fill="none" stroke="${accent}" stroke-width="2" opacity="0.6"/>
<g fill="${accent}" opacity="0.6">
<circle cx="90" cy="60" r="3"/><circle cx="150" cy="100" r="2"/><circle cx="230" cy="50" r="3"/><circle cx="300" cy="90" r="2"/><circle cx="540" cy="70" r="2"/>
</g>
`
    default:
      return `<circle cx="300" cy="140" r="80" fill="${accent}" opacity="0.2"/>`
  }
}

function artDataUrl(id: string): string | null {
  const path = `scripts/demo-art/${id}.jpg`
  if (!existsSync(path)) return null
  return `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`
}

function coverDataUrl(
  id: string,
  title: string,
  accent: string,
  bg: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
<rect width="600" height="360" fill="${bg}"/>
${artwork(id, accent)}
<text x="44" y="312" fill="${accent}" font-family="Georgia, serif" font-size="40">${escapeXml(title)}</text>
<text x="44" y="340" fill="#9a97a8" font-family="sans-serif" font-size="16">Knotebook demo</text>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function sceneDataUrl(accent: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
<rect width="600" height="360" fill="${bg}"/>
<g stroke="${accent}" stroke-width="3" opacity="0.8">
<path d="M60 300 L180 120 L300 300 Z" fill="none"/>
<path d="M220 300 L340 90 L460 300 Z" fill="none"/>
<path d="M380 300 L500 140 L560 300 Z" fill="none"/>
</g>
<circle cx="470" cy="80" r="26" fill="${accent}" opacity="0.35"/>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const secretPath = 'keys/store-secret.txt'
const secret = existsSync(secretPath)
  ? new Uint8Array(
      Buffer.from(readFileSync(secretPath, 'utf8').trim(), 'base64'),
    )
  : null
const keyPair = secret ? nacl.sign.keyPair.fromSecretKey(secret) : null
const publicKey = keyPair
  ? Buffer.from(keyPair.publicKey).toString('base64')
  : undefined

const packs = demos.map((demo) => {
  const compiled = compileInk(demo.source)
  if (!compiled.ok) {
    console.error(`Could not compile ${demo.id}`)
    console.error(compiled.issues)
    process.exit(1)
  }
  const theme = getTheme(demo.theme)
  const generatedCover = artDataUrl(demo.id)
  const cover =
    generatedCover ?? coverDataUrl(demo.id, demo.title, theme.accent, theme.bg)
  const coverPath = generatedCover ? 'assets/cover.jpg' : 'assets/cover.svg'
  const assets: Record<string, string> = { [coverPath]: cover }
  if (demo.scene) {
    assets['assets/scene.svg'] = sceneDataUrl(theme.accent, theme.bg)
  }
  const pack = buildPack({
    title: demo.title,
    release: '1.0.0',
    author: 'Knotebook',
    description: demo.description,
    theme: demo.theme,
    storyJson: compiled.json,
    cover,
    assets,
  })
  const json = JSON.stringify(pack, null, 2)
  const bytes = new Uint8Array(Buffer.from(json, 'utf8'))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const signature =
    secret && keyPair
      ? Buffer.from(nacl.sign.detached(bytes, secret)).toString('base64')
      : undefined
  return { demo, pack, json, sha256, signature }
})

mkdirSync('public', { recursive: true })
for (const { demo, json } of packs) {
  writeFileSync(`public/${demo.id}.knotebook.json`, json)
}
const lantern = packs.find((entry) => entry.demo.id === 'the-lantern-keepers')
if (lantern) {
  writeFileSync('public/sample.knotebook.json', lantern.json)
}

const catalogue = {
  format: 'knotebook-catalogue',
  version: 1,
  generated: new Date().toISOString(),
  publicKey,
  packs: packs.map(({ demo, pack, sha256, signature }) => ({
    id: pack.id,
    title: pack.title,
    author: pack.author,
    theme: pack.theme,
    release: pack.release,
    sha256,
    url: `${demo.id}.knotebook.json`,
    description: pack.description,
    licence: pack.licence,
    cover: pack.cover,
    signature,
  })),
}

writeFileSync('public/catalogue.json', JSON.stringify(catalogue, null, 2))
console.log(`Wrote public/catalogue.json with ${packs.length} demo pack(s)`)
console.log(
  signatureLabel(publicKey, packs.every((entry) => entry.signature)),
)
console.log(packs.map((entry) => `- ${entry.demo.id}`).join('\n'))

function signatureLabel(key: string | undefined, allSigned: boolean): string {
  if (!key) return 'Unsigned demo catalogue (no keys/store-secret.txt)'
  return allSigned
    ? `Signed demo catalogue (public key ${key})`
    : 'Some packs are unsigned'
}