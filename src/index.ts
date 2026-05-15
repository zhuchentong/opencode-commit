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

/**
 * OpenCode 中文约定式提交插件
 *
 * 注册 /commit 命令及一系列 git 操作工具，帮助用户
 * 按照约定式提交规范生成、验证并提交中文提交信息。
 *
 * @param ctx - OpenCode 插件上下文，包含 SDK 客户端、Shell、项目信息等
 * @returns 插件钩子集合
 */
export const OpencodeCommitPlugin: Plugin = async (ctx: PluginInput) => {
  // 加载项目级配置（opencode-commit.json），不存在则使用默认值
  const commitConfig = await loadConfig(ctx.directory)

  return {
    /**
     * 配置钩子 - 注册 /commit 斜杠命令
     * @param cfg - OpenCode 配置对象
     */
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
          '3. 选项：确认提交、重新生成、取消。' +
          '如果用户选择"重新生成"，则先调用 git-status、git-diff 检测工作区未提交的文件，' +
          '然后重新生成提交信息并再次验证和确认。' +
          '用户确认后调用 commit-message-confirm 提交。',
        subtask: true,
      }
    },

    /**
     * 工具注册 - 向 OpenCode 注册所有自定义工具
     */
    tool: {
      'commit-message-generate': createGenerateTool(ctx.$, commitConfig), // 生成提交格式指南
      'commit-message-validate': createValidateTool(commitConfig), // 验证提交信息格式
      'commit-message-confirm': createConfirmTool(ctx.$, commitConfig), // 确认并提交
      'git-amend': createAmendTool(ctx.$, commitConfig), // 修改最近一次提交
      'git-diff': createDiffTool(ctx.$), // 查看暂存区差异
      'git-log': createLogTool(ctx.$), // 查看提交历史
      'git-status': createStatusTool(ctx.$), // 查看工作树状态
      'git-undo': createUndoTool(ctx.$), // 撤销最近提交
    },
  }
}
