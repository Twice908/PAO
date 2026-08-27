/**
 * Renders the ingest OpenAPI spec to a static HTML page served at /docs/api,
 * and copies the raw spec to /openapi.yaml.
 *
 * Both are generated into public/ at build time from apps/api/openapi/openapi.yaml,
 * which is the single source of truth (openapi-contract.test.ts asserts it against
 * the real Zod schema, so drift fails the build there rather than shipping here).
 *
 * The rendered page references Redoc from a CDN, but the tag redocly-cli emits is
 * version-pinned and carries an SRI integrity hash with crossorigin="anonymous",
 * so the bundle cannot change under us. Vendoring the 1 MB minified blob into the
 * repo was the alternative and is worse to maintain.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spec = resolve(here, '../../api/openapi/openapi.yaml')
const publicDir = resolve(here, '../public')
const docsHtml = resolve(publicDir, 'docs/api/index.html')

mkdirSync(dirname(docsHtml), { recursive: true })

// Raw spec: what Make imports and Zapier reviewers link to.
copyFileSync(spec, resolve(publicDir, 'openapi.yaml'))

execFileSync(
  'npx',
  ['redocly', 'build-docs', spec, '-o', docsHtml, '--title', 'PAO Ingest API reference'],
  { stdio: 'inherit' },
)

console.log('[openapi] spec -> public/openapi.yaml, docs -> public/docs/api/index.html')
