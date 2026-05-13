import type { CommitConfig } from './config.js'
import { getAllScopes } from './config.js'
import { CommitError } from './errors.js'
import { parseCommitMessage } from './parser.js'

/**
 * 验证提交信息是否符合配置规则
 *
 * 依次检查：提交类型是否合法、作用域是否在允许列表内、
 * 提交信息是否超过最大长度限制。
 * 验证不通过时抛出 CommitError 并附带修正建议。
 *
 * @param message - 待验证的提交信息
 * @param config - 提交配置（包含允许的类型、作用域和最大长度）
 * @throws {CommitError} 验证失败时抛出，包含错误描述和修正建议
 */
export const validateCommitMessage = (message: string, config: CommitConfig): void => {
  // 解析提交信息为结构化对象
  const parsed = parseCommitMessage(message)

  // 检查提交类型是否在配置的允许列表中
  if (!config.types.includes(parsed.type)) {
    // 提取类型首字母，用于生成模糊匹配建议
    const firstChar = parsed.type[0]
    // 筛选出首字母相同的有效类型
    const close = firstChar ? config.types.filter(t => t.startsWith(firstChar)) : []

    const suggestions = close.length > 0
      ? [`你是否想用: ${close.join(', ')}?`]
      : [`有效类型为: ${config.types.join(', ')}`]

    throw new CommitError(`无效的提交类型: "${parsed.type}"`, suggestions)
  }

  // 检查作用域是否在允许列表中（仅当配置了作用域限制时）
  const allowedScopes = getAllScopes(config)
  if (parsed.scope && allowedScopes && !allowedScopes.includes(parsed.scope)) {
    throw new CommitError(`无效的作用域: "${parsed.scope}"`, [
      `允许的作用域为: ${allowedScopes.join(', ')}`,
    ])
  }

  // 检查提交信息长度是否超过限制
  if (parsed.raw.length > config.maxLength) {
    throw new CommitError(
      `提交信息超过 ${config.maxLength} 个字符 (${parsed.raw.length})`,
      ['请更简洁一些'],
    )
  }
}
