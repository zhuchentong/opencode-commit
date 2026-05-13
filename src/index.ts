import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { loadConfig } from './config.js'
import {
  createAmendTool,
  createConfirmTool,
  createDiffTool,
  createGenerateTool,
  createLogTool,
  createStatusTool,
  createUndoTool,
  createValidateTool,
} from './tools.js'

export const OpencodeCommitPlugin: Plugin = async (ctx: PluginInput) => {
  const commitConfig = await loadConfig(ctx.directory)

  return {
    config: async (cfg) => {
      cfg.command = cfg.command || {}
      cfg.command['commit'] = {
        description: '根据变更内容生成中文提交信息，确认后提交',
        template:
          '依次调用 git-diff、git-status、git-log 收集变更上下文，' +
          '再调用 commit-message-generate 获取格式指南，' +
          '然后根据上下文和指南生成一条中文提交信息。' +
          '绝大多数情况只需一行 subject，不要生成 body。' +
          '生成后立即调用 commit-message-validate 验证格式，' +
          '如果验证失败，根据错误建议修正后重新验证，直到验证通过。' +
          '验证通过后用 question 工具让用户确认：' +
          '1. question 内容为 "确认提交以下信息？\\n\\n<完整提交信息>"；' +
          '2. 设置 custom: true；' +
          '3. 选项：确认提交、取消。' +
          '用户确认后调用 commit-message-confirm 提交。',
        subtask: true,
      }
    },

    tool: {
      'commit-message-generate': createGenerateTool(ctx.$, commitConfig),
      'commit-message-validate': createValidateTool(commitConfig),
      'commit-message-confirm': createConfirmTool(ctx.$, commitConfig),
      'git-amend': createAmendTool(ctx.$, commitConfig),
      'git-diff': createDiffTool(ctx.$),
      'git-log': createLogTool(ctx.$),
      'git-status': createStatusTool(ctx.$),
      'git-undo': createUndoTool(ctx.$),
    },
  }
}
