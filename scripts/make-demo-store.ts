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

function coverDataUrl(title: string, accent: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
<rect width="600" height="360" fill="${bg}"/>
<rect x="20" y="20" width="560" height="320" rx="16" fill="none" stroke="${accent}" stroke-width="3"/>
<text x="44" y="150" fill="${accent}" font-family="Georgia, serif" font-size="44">${escapeXml(title)}</text>
<text x="44" y="198" fill="#9a97a8" font-family="sans-serif" font-size="18">Knotebook demo</text>
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
  const cover = coverDataUrl(demo.title, theme.accent, theme.bg)
  const assets: Record<string, string> = { 'assets/cover.svg': cover }
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