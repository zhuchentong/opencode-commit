import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tool } from '@opencode-ai/plugin'
import { safeAsync } from './safe.js'

const z = tool.schema

export const DEFAULT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'revert',
] as const

export const DEFAULT_MAX_LENGTH = 72

const rawConfigSchema = z.object({
  types: z.array(z.string()).optional(),
  scopes: z.record(z.string(), z.array(z.string())).optional(),
  maxLength: z.number().optional(),
})

export type CommitConfig = {
  types: string[]
  scopes?: Record<string, string[]>
  maxLength: number
}

export const loadConfig = async (directory: string): Promise<CommitConfig> => {
  const configPath = join(directory, 'opencode-commit.json')

  const result = await safeAsync(async () => {
    const raw = await readFile(configPath, 'utf-8')
    return rawConfigSchema.parse(JSON.parse(raw))
  })

  if (result.error) {
    return {
      types: [...DEFAULT_TYPES],
      maxLength: DEFAULT_MAX_LENGTH,
    }
  }

  return {
    types: result.data.types ?? [...DEFAULT_TYPES],
    scopes: result.data.scopes,
    maxLength: result.data.maxLength ?? DEFAULT_MAX_LENGTH,
  }
}

export const getAllScopes = (config: CommitConfig): string[] | undefined => {
  if (!config.scopes) return undefined
  return Object.values(config.scopes).flat()
}
