import type { CommitConfig } from './config.js'
import { getAllScopes } from './config.js'
import { CommitError } from './errors.js'
import { parseCommitMessage } from './parser.js'

export const validateCommitMessage = (message: string, config: CommitConfig): void => {
  const parsed = parseCommitMessage(message)

  if (!config.types.includes(parsed.type)) {
    const firstChar = parsed.type[0]
    const close = firstChar ? config.types.filter(t => t.startsWith(firstChar)) : []

    const suggestions = close.length > 0
      ? [`你是否想用: ${close.join(', ')}?`]
      : [`有效类型为: ${config.types.join(', ')}`]

    throw new CommitError(`无效的提交类型: "${parsed.type}"`, suggestions)
  }

  const allowedScopes = getAllScopes(config)
  if (parsed.scope && allowedScopes && !allowedScopes.includes(parsed.scope)) {
    throw new CommitError(`无效的作用域: "${parsed.scope}"`, [
      `允许的作用域为: ${allowedScopes.join(', ')}`,
    ])
  }

  if (parsed.raw.length > config.maxLength) {
    throw new CommitError(
      `提交信息超过 ${config.maxLength} 个字符 (${parsed.raw.length})`,
      ['请更简洁一些'],
    )
  }
}
