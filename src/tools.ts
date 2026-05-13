import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import type { CommitConfig } from './config.js'
import { CommitError } from './errors.js'
import { COMMIT_GUIDE, MAX_DIFF_LINES } from './guide.js'
import { safe, safeAsync } from './safe.js'
import { validateCommitMessage } from './validator.js'

type BunShell = PluginInput['$']

export const formatValidationError = (error: Error): string => {
  if (error instanceof CommitError && error.suggestions.length > 0) {
    return error.message + '\n\n建议:\n' + error.suggestions.map(s => `- ${s}`).join('\n')
  }
  return error.message
}

const truncateDiff = (diff: string): string => {
  const lines = diff.split('\n')
  if (lines.length <= MAX_DIFF_LINES) return diff
  return (
    lines.slice(0, MAX_DIFF_LINES).join('\n') +
    `\n\n... (已截断，省略 ${lines.length - MAX_DIFF_LINES} 行)`
  )
}

const commitAndReport = async (
  $: BunShell,
  message: string,
  config: CommitConfig,
  flag: '' | '--amend',
) => {
  const validation = safe(() => validateCommitMessage(message, config))
  if (validation.error) {
    return formatValidationError(validation.error)
  }

  const cmd = flag === '--amend' ? $`git commit --amend -m ${message}` : $`git commit -m ${message}`
  const result = await safeAsync(() => cmd.text())
  if (result.error) {
    const msg = String(result.error.message || result.error)
    if (msg.includes('nothing to commit')) {
      return '> 没有需要提交的变更。'
    }
    if (msg.includes('pre-commit') || msg.includes('hook')) {
      return `> Pre-commit hook 失败：${msg}`
    }
    return `> 提交失败：${msg}`
  }

  const hashResult = await safeAsync(() => $`git rev-parse --short HEAD`.text())
  const branchResult = await safeAsync(() => $`git branch --show-current`.text())

  const hash = hashResult.data?.trim() ?? 'unknown'
  const branch = branchResult.data?.trim() ?? 'unknown'

  const action = flag === '--amend' ? '修改成功' : '提交成功'

  return {
    output: `✅ ${action}！\n- 分支: ${branch}\n- Hash: ${hash}\n\n${result.data}`,
    metadata: { branch, hash },
  }
}

export const createValidateTool = (config: CommitConfig): ToolDefinition => {
  return tool({
    description: '验证提交信息是否符合约定式提交格式。在用户确认前调用，验证失败时根据建议修正后重新验证。',
    args: {
      message: tool.schema.string().describe('待验证的中文约定式提交信息'),
    },
    async execute(args) {
      const result = safe(() => validateCommitMessage(args.message, config))
      if (result.error) {
        return `❌ 验证失败: ${formatValidationError(result.error)}`
      }
      return `✅ 验证通过: ${args.message}`
    },
  })
}

export const createGenerateTool = ($: BunShell, config: CommitConfig): ToolDefinition => {
  return tool({
    description: '返回中文约定式提交格式指南。优先读取项目根目录的 COMMITS.md，不存在则使用内置指南。',
    args: {},
    async execute(_args, context) {
      context.metadata({ title: '📋 返回提交格式指南' })

      const result = await safeAsync(async () => {
        const content = await readFile(join(context.directory, 'COMMITS.md'), 'utf-8')
        return content.trim()
      })

      if (result.data) {
        return result.data
      }

      return COMMIT_GUIDE
    },
  })
}

export const createConfirmTool = ($: BunShell, config: CommitConfig): ToolDefinition => {
  return tool({
    description: '使用指定的提交信息提交暂存的变更。仅在用户确认后才调用此工具。',
    args: {
      message: tool.schema.string().describe('中文约定式提交信息，含 emoji'),
    },
    async execute(args, context) {
      context.metadata({ title: `🚀 ${args.message}` })

      const result = await commitAndReport($, args.message, config, '')
      if (typeof result === 'string') {
        return result
      }

      context.metadata({
        title: `✅ ${args.message}`,
        metadata: result.metadata,
      })

      return result
    },
  })
}

export const createAmendTool = ($: BunShell, config: CommitConfig): ToolDefinition => {
  return tool({
    description: '使用新的验证过的提交信息修改最后一次提交',
    args: {
      message: tool.schema.string().describe('新的中文约定式提交信息'),
    },
    async execute(args, context) {
      context.metadata({ title: `📝 修改提交: ${args.message}` })

      const result = await commitAndReport($, args.message, config, '--amend')
      if (typeof result === 'string') {
        return result
      }

      context.metadata({
        title: `✅ ${args.message}`,
        metadata: result.metadata,
      })

      return result
    },
  })
}

export const createDiffTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '显示当前暂存的 diff。如果没有暂存的变更，会自动暂存所有变更。',
    args: {
      staged: tool.schema.boolean().optional().describe('显示暂存的变更（默认: true）'),
    },
    async execute(args, context) {
      const showStaged = args.staged !== false

      const statResult = await safeAsync(() => $`git diff --cached --stat`.text())
      if (statResult.error) {
        const msg = String(statResult.error.message || statResult.error)
        if (msg.includes('not a git repository')) {
          return '> 当前目录不是 Git 仓库。'
        }
        return `> 获取 diff 失败：${msg}`
      }

      if (showStaged && !statResult.data.trim()) {
        await safeAsync(() => $`git add -A`.text())
        context.metadata({ title: '📦 自动暂存变更...' })
      }

      const flag = showStaged ? '--staged' : ''
      const result = await safeAsync(() => $`git diff ${flag}`.text())
      if (result.error) {
        return `> 获取 diff 失败：${result.error.message}`
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return showStaged ? '没有暂存的变更。' : '没有未暂存的变更。'
      }

      return `\`\`\`diff\n${truncateDiff(trimmed)}\n\`\`\``
    },
  })
}

export const createLogTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '显示最近的提交历史',
    args: {
      count: tool.schema.number().optional().describe('显示的提交数量（默认: 10）'),
    },
    async execute(args) {
      const count = args.count ?? 10

      const result = await safeAsync(() => $`git log --oneline -n ${count}`.text())
      if (result.error) {
        return `> 获取 git log 失败：${result.error.message}`
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return '没有找到提交记录。'
      }

      return `\`\`\`\n${trimmed}\n\`\`\``
    },
  })
}

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

export const createUndoTool = ($: BunShell): ToolDefinition => {
  return tool({
    description: '撤销最近的提交，保留变更在暂存区',
    args: {
      count: tool.schema.number().optional().describe('撤销的提交数量（默认: 1）'),
    },
    async execute(args) {
      const count = args.count ?? 1

      const result = await safeAsync(() => $`git reset --soft HEAD~${count}`.text())
      if (result.error) {
        return `> 撤销提交失败：${result.error.message}`
      }

      return `已撤销 ${count} 个提交（变更保留在暂存区）`
    },
  })
}
