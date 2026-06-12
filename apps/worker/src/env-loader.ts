import { config } from 'dotenv'
import { resolve } from 'node:path'

// Load .env from monorepo root before any module reads process.env.
// Must be the first import in the entry point.
config({ path: resolve(__dirname, '../../../.env') })
