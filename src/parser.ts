import { CommitError } from './errors.js'

export type ParsedCommitMessage = {
  type: string
  scope?: string
  description: string
  emoji?: string
  raw: string
}

const EMOJI_VALUES = ['✨', '🐛', '📝', '💄', '♻️', '⚡', '✅', '🔧', '⏪']

const emojiPattern = new RegExp(
  `[${EMOJI_VALUES.join('')}\\u{1F300}-\\u{1F9FF}]`,
  'u',
)

export const parseCommitMessage = (message: string): ParsedCommitMessage => {
  const trimmed = message.trim()

  if (!trimmed) {
    throw new CommitError('提交信息不能为空', [
      '请提供格式为 <type>[(<scope>)]: <description> 的提交信息',
    ])
  }

  const colonIndex = trimmed.indexOf(':')
  if (colonIndex === -1) {
    throw new CommitError('提交信息必须包含冒号分隔符', [
      '请使用格式: <type>[(<scope>)]: <description>',
      `示例: feat: ${trimmed}`,
    ])
  }

  const prefix = trimmed.slice(0, colonIndex)
  const afterColon = trimmed.slice(colonIndex + 1).trim()

  const { type, scope } = parsePrefix(prefix)

  if (!type) {
    throw new CommitError('提交类型不能为空', [
      '请在冒号前提供类型',
      '示例: feat: 添加新功能',
    ])
  }

  if (!/^[a-z]+$/.test(type)) {
    throw new CommitError('提交类型必须只包含小写字母', [
      `将 "${type}" 改为小写字母`,
      '有效类型包括: feat, fix, docs, style, refactor, test, chore',
    ])
  }

  if (!afterColon) {
    throw new CommitError('提交描述不能为空', [
      '请在冒号后提供描述',
      `示例: ${prefix}: 添加新功能`,
    ])
  }

  const { description, emoji } = parseDescription(afterColon)

  return { type, scope, description, emoji, raw: trimmed }
}

type PrefixParts = {
  type: string
  scope?: string
}

const parsePrefix = (prefix: string): PrefixParts => {
  const parenOpen = prefix.indexOf('(')
  const parenClose = prefix.indexOf(')')

  if (parenOpen === -1 && parenClose === -1) {
    return { type: prefix }
  }

  if (parenOpen === -1) {
    throw new CommitError('发现右括号但没有对应的左括号', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  if (parenClose === -1) {
    throw new CommitError('发现左括号但没有对应的右括号', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  if (parenClose < parenOpen) {
    throw new CommitError('提交信息中括号不匹配', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  if (parenClose !== prefix.length - 1) {
    throw new CommitError('作用域括号后有意外字符', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  const type = prefix.slice(0, parenOpen)
  const scope = prefix.slice(parenOpen + 1, parenClose)

  if (!scope) {
    throw new CommitError('括号存在时作用域不能为空', [
      '请提供作用域或删除括号',
    ])
  }

  if (!/^[a-z]/.test(scope)) {
    throw new CommitError('作用域必须以小写字母开头', [
      `将 "${scope}" 改为以小写字母开头`,
    ])
  }

  if (!/^[a-z][a-zA-Z0-9-]*$/.test(scope)) {
    throw new CommitError('作用域只能包含字母、数字和连字符', [
      `将 "${scope}" 改为只使用字母、数字和连字符`,
    ])
  }

  return { type, scope }
}

const parseDescription = (text: string): { description: string; emoji?: string } => {
  const match = text.match(emojiPattern)

  if (match) {
    const emoji = match[0]
    const description = text.replace(emojiPattern, '').trim()
    return { description, emoji }
  }

  return { description: text }
}
