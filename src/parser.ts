import { CommitError } from './errors.js'

/** 解析后的提交信息结构 */
export type ParsedCommitMessage = {
  /** 提交类型，如 feat、fix 等 */
  type: string
  /** 可选的作用域，如 core、ui 等 */
  scope?: string
  /** 提交描述文本 */
  description: string
  /** 可选的 emoji，如 ✨、🐛 等 */
  emoji?: string
  /** 原始提交信息（去除首尾空格后） */
  raw: string
}

/** 内置支持的 emoji 列表 */
const EMOJI_VALUES = ['✨', '🐛', '📝', '💄', '♻️', '⚡', '✅', '🔧', '⏪']

/** 用于匹配提交描述中 emoji 的正则表达式 */
const emojiPattern = new RegExp(
  `[${EMOJI_VALUES.join('')}\\u{1F300}-\\u{1F9FF}]`,
  'u',
)

/**
 * 解析中文约定式提交信息
 *
 * 将形如 "feat(core): 添加新功能 ✨" 的提交信息拆解为
 * type、scope、description 和 emoji 四部分。
 * 解析失败时抛出 CommitError 并附带修正建议。
 *
 * @param message - 原始提交信息
 * @returns 结构化的提交信息对象
 * @throws {CommitError} 格式不合法时抛出
 */
export const parseCommitMessage = (message: string): ParsedCommitMessage => {
  // 去除首尾空白
  const trimmed = message.trim()

  // 空信息检查
  if (!trimmed) {
    throw new CommitError('提交信息不能为空', [
      '请提供格式为 <type>[(<scope>)]: <description> 的提交信息',
    ])
  }

  // 冒号是类型前缀和描述的分隔符，必须存在
  const colonIndex = trimmed.indexOf(':')
  if (colonIndex === -1) {
    throw new CommitError('提交信息必须包含冒号分隔符', [
      '请使用格式: <type>[(<scope>)]: <description>',
      `示例: feat: ${trimmed}`,
    ])
  }

  // 冒号前的部分为类型和作用域前缀
  const prefix = trimmed.slice(0, colonIndex)
  // 冒号后的部分为描述（去除前导空格）
  const afterColon = trimmed.slice(colonIndex + 1).trim()

  // 解析类型和可选作用域
  const { type, scope } = parsePrefix(prefix)

  // 类型不能为空
  if (!type) {
    throw new CommitError('提交类型不能为空', [
      '请在冒号前提供类型',
      '示例: feat: 添加新功能',
    ])
  }

  // 类型必须只包含小写字母
  if (!/^[a-z]+$/.test(type)) {
    throw new CommitError('提交类型必须只包含小写字母', [
      `将 "${type}" 改为小写字母`,
      '有效类型包括: feat, fix, docs, style, refactor, test, chore',
    ])
  }

  // 描述不能为空
  if (!afterColon) {
    throw new CommitError('提交描述不能为空', [
      '请在冒号后提供描述',
      `示例: ${prefix}: 添加新功能`,
    ])
  }

  // 从描述中提取 emoji
  const { description, emoji } = parseDescription(afterColon)

  return { type, scope, description, emoji, raw: trimmed }
}

/** 前缀解析结果（类型 + 可选作用域） */
type PrefixParts = {
  /** 提交类型 */
  type: string
  /** 可选作用域 */
  scope?: string
}

/**
 * 解析提交信息前缀（类型和作用域）
 *
 * 处理以下格式：
 * - "feat" → { type: "feat" }
 * - "feat(core)" → { type: "feat", scope: "core" }
 *
 * @param prefix - 冒号前的前缀字符串
 * @returns 类型与可选作用域
 * @throws {CommitError} 括号不匹配或格式错误时抛出
 */
const parsePrefix = (prefix: string): PrefixParts => {
  // 查找括号位置
  const parenOpen = prefix.indexOf('(')
  const parenClose = prefix.indexOf(')')

  // 没有括号则直接返回类型
  if (parenOpen === -1 && parenClose === -1) {
    return { type: prefix }
  }

  // 只有右括号没有左括号
  if (parenOpen === -1) {
    throw new CommitError('发现右括号但没有对应的左括号', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  // 只有左括号没有右括号
  if (parenClose === -1) {
    throw new CommitError('发现左括号但没有对应的右括号', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  // 括号顺序颠倒
  if (parenClose < parenOpen) {
    throw new CommitError('提交信息中括号不匹配', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  // 右括号不在末尾，说明括号后有额外字符
  if (parenClose !== prefix.length - 1) {
    throw new CommitError('作用域括号后有意外字符', [
      '请使用格式: <type>(<scope>): <description>',
    ])
  }

  // 提取类型（括号前的部分）
  const type = prefix.slice(0, parenOpen)
  // 提取作用域（括号内的部分）
  const scope = prefix.slice(parenOpen + 1, parenClose)

  // 括号内不能为空
  if (!scope) {
    throw new CommitError('括号存在时作用域不能为空', [
      '请提供作用域或删除括号',
    ])
  }

  // 作用域必须以小写字母开头
  if (!/^[a-z]/.test(scope)) {
    throw new CommitError('作用域必须以小写字母开头', [
      `将 "${scope}" 改为以小写字母开头`,
    ])
  }

  // 作用域只能包含字母、数字和连字符
  if (!/^[a-z][a-zA-Z0-9-]*$/.test(scope)) {
    throw new CommitError('作用域只能包含字母、数字和连字符', [
      `将 "${scope}" 改为只使用字母、数字和连字符`,
    ])
  }

  return { type, scope }
}

/**
 * 解析提交描述，提取 emoji
 *
 * 从描述文本中识别并分离 emoji 字符。
 * 例如 "添加新功能 ✨" → { description: "添加新功能", emoji: "✨" }
 *
 * @param text - 冒号后的描述文本
 * @returns 分离后的描述和可选 emoji
 */
const parseDescription = (text: string): { description: string; emoji?: string } => {
  // 从描述开头匹配 emoji
  const match = text.match(new RegExp(`^\\s*(${emojiPattern.source})`, 'u'))

  if (match) {
    // 提取开头 emoji 并从描述中移除
    const emoji = match[1]
    const description = text.slice(match[0].length).trim()
    return { description, emoji }
  }

  // 无 emoji，原样返回描述
  return { description: text }
}
