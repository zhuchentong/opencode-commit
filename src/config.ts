import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tool } from '@opencode-ai/plugin'
import { safeAsync } from './safe.js'

// 使用 OpenCode plugin 的 schema 构建器
const z = tool.schema

/** 默认支持的提交类型列表 */
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

/** 提交信息的默认最大字符长度 */
export const DEFAULT_MAX_LENGTH = 72

/** 配置文件原始结构的校验 schema */
const rawConfigSchema = z.object({
  types: z.array(z.string()).optional(),
  scopes: z.record(z.string(), z.array(z.string())).optional(),
  maxLength: z.number().optional(),
})

/** 解析后的提交配置 */
export type CommitConfig = {
  /** 允许的提交类型 */
  types: string[]
  /** 作用域映射表（键为类别，值为允许的作用域列表） */
  scopes?: Record<string, string[]>
  /** 提交信息最大字符长度 */
  maxLength: number
}

/**
 * 加载项目级提交配置
 *
 * 从项目根目录读取 opencode-commit.json 配置文件，
 * 解析并合并默认值。文件不存在或格式错误时返回默认配置。
 *
 * @param directory - 项目根目录路径
 * @returns 合并后的提交配置
 */
export const loadConfig = async (directory: string): Promise<CommitConfig> => {
  // 拼接配置文件路径
  const configPath = join(directory, 'opencode-commit.json')

  // 安全读取并解析配置文件
  const result = await safeAsync(async () => {
    const raw = await readFile(configPath, 'utf-8')
    return rawConfigSchema.parse(JSON.parse(raw))
  })

  // 配置文件不存在或解析失败，使用默认值
  if (result.error) {
    return {
      types: [...DEFAULT_TYPES],
      maxLength: DEFAULT_MAX_LENGTH,
    }
  }

  // 合并用户配置与默认值
  return {
    types: result.data.types ?? [...DEFAULT_TYPES],
    scopes: result.data.scopes,
    maxLength: result.data.maxLength ?? DEFAULT_MAX_LENGTH,
  }
}

/**
 * 获取所有允许的作用域列表
 *
 * 将配置中的作用域映射表展平为一维数组。
 *
 * @param config - 提交配置
 * @returns 所有可能的作用域列表，未配置时返回 undefined
 */
export const getAllScopes = (config: CommitConfig): string[] | undefined => {
  // 未配置作用域则不限制
  if (!config.scopes) return undefined
  // 将所有类别下的作用域合并去重
  return Object.values(config.scopes).flat()
}
