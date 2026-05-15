import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import type { CommitConfig } from './config.js'
import { CommitError } from './errors.js'
import { COMMIT_GUIDE, MAX_DIFF_LINES } from './guide.js'
import { safe, safeAsync } from './safe.js'
import { validateCommitMessage } from './validator.js'

/** Bun Shell 类型别名 */
type BunShell = PluginInput['$']

/**
 * 格式化验证错误信息
 *
 * 当错误为 CommitError 且包含建议时，将建议追加到错误信息中；
 * 否则直接返回错误信息。
 *
 * @param error - 验证过程中产生的错误
 * @returns 格式化后的错误字符串
 */
export const formatValidationError = (error: Error): string => {
  if (error instanceof CommitError && error.suggestions.length > 0) {
    // 包含建议时，以列表形式追加
    return error.message + '\n\n建议:\n' + error.suggestions.map(s => `- ${s}`).join('\n')
  }
  return error.message
}

/**
 * 截断过长的 diff 输出
 *
 * 当 diff 行数超过 MAX_DIFF_LINES 限制时，截取前 N 行
 * 并附加省略提示，避免工具返回内容过大。
 *
 * @param diff - 原始 diff 字符串
 * @returns 截断后的 diff 字符串
 */
const truncateDiff = (diff: string): string => {
  // 按行拆分
  const lines = diff.split('\n')
  // 未超限则原样返回
  if (lines.length <= MAX_DIFF_LINES) return diff
  // 截取前 N 行并附加省略提示
  return (
    lines.slice(0, MAX_DIFF_LINES).join('\n') +
    `\n\n... (已截断，省略 ${lines.length - MAX_DIFF_LINES} 行)`
  )
}

/**
 * 执行 git commit 并报告结果
 *
 * 内部会先验证提交信息格式，然后执行 git commit，
 * 最后获取当前分支和 commit hash 生成报告。
 *
 * @param $ - Bun Shell 实例
 * @param message - 提交信息
 * @param config - 提交配置
 * @param flag - 额外的 commit 标志，空字符串表示普通提交，'--amend' 表示修改提交
 * @returns 成功时返回包含输出和元数据的对象，失败时返回错误字符串
 */
const commitAndReport = async (
  $: BunShell,
  message: string,
  config: CommitConfig,
  flag: '' | '--amend',
) => {
  // 提交前先验证格式
  const validation = safe(() => validateCommitMessage(message, config))
  if (validation.error) {
    return formatValidationError(validation.error)
  }

  // 根据 flag 决定执行普通提交还是 amend 提交
  const cmd = flag === '--amend' ? $`git commit --amend -m ${message}` : $`git commit -m ${message}`
  const result = await safeAsync(() => cmd.text())
  if (result.error) {
    // 将错误转为字符串
    const msg = String(result.error.message || result.error)
    // 没有变更可提交
    if (msg.includes('nothing to commit')) {
      return '> 没有需要提交的变更。'
    }
    // pre-commit hook 失败
    if (msg.includes('pre-commit') || msg.includes('hook')) {
      return `> Pre-commit hook 失败：${msg}`
    }
    // 其他错误
    return `> 提交失败：${msg}`
  }

  // 获取提交后的短 hash
  const hashResult = await safeAsync(() => $`git rev-parse --short HEAD`.text())
  // 获取当前分支名
  const branchResult = await safeAsync(() => $`git branch --show-current`.text())

  // 提取并清理 hash 和分支名
  const hash = hashResult.data?.trim() ?? 'unknown'
  const branch = branchResult.data?.trim() ?? 'unknown'

  // 根据操作类型选择提示文案
  const action = flag === '--amend' ? '修改成功' : '提交成功'

  return {
    output: `✅ ${action}！\n- 分支: ${branch}\n- Hash: ${hash}\n\n${result.data}`,
    metadata: { branch, hash },
  }
}

/**
 * 创建提交信息验证工具
 *
 * 验证提交信息是否符合约定式提交格式（类型、作用域、长度等），
 * 在用户确认提交前调用。
 *
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createValidateTool = (config: CommitConfig): ToolDefinition => {
  return tool({
    description: '验证提交信息是否符合约定式提交格式。在用户确认前调用，验证失败时根据建议修正后重新验证。',
    args: {
      message: tool.schema.string().describe('待验证的中文约定式提交信息'),
    },
    async execute(args) {
      // 安全执行验证逻辑
      const result = safe(() => validateCommitMessage(args.message, config))
      if (result.error) {
        return `❌ 验证失败: ${formatValidationError(result.error)}`
      }
      return `✅ 验证通过: ${args.message}`
    },
  })
}

/**
 * 创建提交格式指南生成工具
 *
 * 优先读取项目根目录的 COMMITS.md 自定义指南文件，
 * 不存在时使用内置的默认格式指南。
 *
 * @param $ - Bun Shell 实例
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createGenerateTool = ($: BunShell, config: CommitConfig): ToolDefinition => {
  return tool({
    description: '返回中文约定式提交格式指南。优先读取项目根目录的 COMMITS.md，不存在则使用内置指南。',
    args: {},
    async execute(_args, context) {
      context.metadata({ title: '📋 返回提交格式指南' })

      // 尝试读取项目自定义指南文件
      const result = await safeAsync(async () => {
        const content = await readFile(join(context.directory, 'COMMITS.md'), 'utf-8')
        return content.trim()
      })

      // 自定义指南存在则返回
      if (result.data) {
        return result.data
      }

      // 降级为内置指南
      return COMMIT_GUIDE
    },
  })
}

/**
 * 创建提交确认工具
 *
 * 使用指定的提交信息执行 git commit，仅在用户确认后调用。
 *
 * @param $ - Bun Shell 实例
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createConfirmTool = ($: BunShell, config: CommitConfig): ToolDefinition => {
  return tool({
    description: '使用指定的提交信息提交暂存的变更。仅在用户确认后才调用此工具。',
    args: {
      message: tool.schema.string().describe('中文约定式提交信息，含 emoji'),
    },
    async execute(args, context) {
      // 记录即将提交的信息
      context.metadata({ title: `🚀 ${args.message}` })

      // 执行提交并获取报告
      const result = await commitAndReport($, args.message, config, '')
      if (typeof result === 'string') {
        // 字符串表示提交失败
        return result
      }

      // 提交成功，更新元数据
      context.metadata({
        title: `✅ ${args.message}`,
        metadata: result.metadata,
      })

      return result
    },
  })
}

/**
 * 创建提交修改（amend）工具
 *
 * 使用新的提交信息修改最近一次提交（git commit --amend）。
 *
 * @param $ - Bun Shell 实例
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createAmendTool = ($: BunShell, config: CommitConfig): ToolDefinition => {
  return tool({
    description: '使用新的验证过的提交信息修改最后一次提交',
    args: {
      message: tool.schema.string().describe('新的中文约定式提交信息'),
    },
    async execute(args, context) {
      // 记录修改操作
      context.metadata({ title: `📝 修改提交: ${args.message}` })

      // 执行 amend 提交
      const result = await commitAndReport($, args.message, config, '--amend')
      if (typeof result === 'string') {
        return result
      }

      // 修改成功，更新元数据
      context.metadata({
        title: `✅ ${args.message}`,
        metadata: result.metadata,
      })

      return result
    },
  })
}

/**
 * 创建 git diff 工具
 *
 * 显示当前暂存的变更差异。如果暂存区为空，会自动执行 git add -A
 * 将所有变更暂存后再显示 diff。
 *
 * @param $ - Bun Shell 实例
 * @returns 工具定义
 */
export const createDiffTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '显示当前暂存的 diff。如果没有暂存的变更，会自动暂存所有变更。',
    args: {
      staged: tool.schema.boolean().optional().describe('显示暂存的变更（默认: true）'),
    },
    async execute(args, context) {
      // 默认显示暂存区变更
      const showStaged = args.staged !== false

      // 检查是否有未暂存的变更（工作区 vs 暂存区）
      const unstagedResult = await safeAsync(() => $`git diff --stat`.text())
      if (unstagedResult.error) {
        const msg = String(unstagedResult.error.message || unstagedResult.error)
        if (msg.includes('not a git repository')) {
          return '> 当前目录不是 Git 仓库。'
        }
        return `> 获取 diff 失败：${msg}`
      }

      // 存在未暂存变更时自动 add 所有变更
      if (unstagedResult.data?.trim()) {
        await safeAsync(() => $`git add -A`.text())
        context.metadata({ title: '📦 自动暂存变更...' })
      }

      // 根据参数选择查看暂存区或工作区差异
      const flag = showStaged ? '--staged' : ''
      const result = await safeAsync(() => $`git diff ${flag}`.text())
      if (result.error) {
        return `> 获取 diff 失败：${result.error.message}`
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return showStaged ? '没有暂存的变更。' : '没有未暂存的变更。'
      }

      // 返回 markdown diff 代码块，超长时截断
      return `\`\`\`diff\n${truncateDiff(trimmed)}\n\`\`\``
    },
  })
}

/**
 * 创建 git log 工具
 *
 * 显示最近 N 条提交历史，使用 oneline 格式。
 *
 * @param $ - Bun Shell 实例
 * @returns 工具定义
 */
export const createLogTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '显示最近的提交历史',
    args: {
      count: tool.schema.number().optional().describe('显示的提交数量（默认: 10）'),
    },
    async execute(args) {
      // 默认显示 10 条
      const count = args.count ?? 10

      const result = await safeAsync(() => $`git log --oneline -n ${count}`.text())
      if (result.error) {
        return `> 获取 git log 失败：${result.error.message}`
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return '没有找到提交记录。'
      }

      // 返回 markdown 代码块
      return `\`\`\`\n${trimmed}\n\`\`\``
    },
  })
}

/**
 * 创建 git status 工具
 *
 * 显示当前工作树状态，包括已暂存、未暂存和未跟踪的文件。
 *
 * @param $ - Bun Shell 实例
 * @returns 工具定义
 */
export const createStatusTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '显示工作树状态，包括暂存、未暂存和未跟踪的文件',
    args: {},
    async execute() {
      const result = await safeAsync(() => $`git status`.text())
      if (result.error) {
        return `> 获取 git status 失败：${result.error.message}`
      }

      return `\`\`\`\n${result.data.trim()}\n\`\`\``
    },
  })
}

/**
 * 创建撤销提交工具
 *
 * 使用 git reset --soft 撤销最近的提交，变更保留在暂存区。
 *
 * @param $ - Bun Shell 实例
 * @returns 工具定义
 */
export const createUndoTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '撤销最近的提交，保留变更在暂存区',
    args: {
      count: tool.schema.number().optional().describe('撤销的提交数量（默认: 1）'),
    },
    async execute(args) {
      // 默认撤销 1 个提交
      const count = args.count ?? 1

      // 软重置，保留变更在暂存区
      const result = await safeAsync(() => $`git reset --soft HEAD~${count}`.text())
      if (result.error) {
        return `> 撤销提交失败：${result.error.message}`
      }

      return `已撤销 ${count} 个提交（变更保留在暂存区）`
    },
  })
}

/**
 * 创建 git push 工具
 *
 * 执行 git push 并处理常见场景：无远程分支、需要 set-upstream 等。
 *
 * @param $ - Bun Shell 实例
 * @returns 工具定义
 */
export const createPushTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '将当前分支推送到远程仓库',
    args: {},
    async execute(_args, context) {
      context.metadata({ title: '🚀 推送到远程仓库...' })

      // 检查是否有远程仓库
      const remoteResult = await safeAsync(() => $`git remote`.text())
      if (remoteResult.error || !remoteResult.data?.trim()) {
        return '> 当前仓库没有配置远程仓库，无法推送。'
      }

      // 执行 push
      const result = await safeAsync(() => $`git push`.text())
      if (result.error) {
        const msg = String(result.error.message || result.error)
        // 没有上游分支
        if (msg.includes('upstream') || msg.includes('set-upstream')) {
          return `> 当前分支没有设置上游分支。请先执行：git push --set-upstream origin <branch-name>`
        }
        // 被拒绝（可能需要 pull）
        if (msg.includes('rejected')) {
          return `> 推送被拒绝，远程仓库有新的变更。请先执行：git pull --rebase`
        }
        return `> 推送失败：${msg}`
      }

      return `✅ 推送成功！\n\n\`\`\`\n${result.data.trim()}\n\`\`\``
    },
  })
}
