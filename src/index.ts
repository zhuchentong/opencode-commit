import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { $ } from 'bun'

const COMMIT_GUIDE = `## 提交信息格式要求

你必须严格按照以下规范生成提交信息。

### 格式
\`\`\`
<type>: <subject> <emoji>
\`\`\`

### 类型与对应 emoji
- feat: 新功能 ✨
- fix: 修复 bug 🐛
- docs: 文档更新 📝
- style: 代码格式化 💄
- refactor: 重构代码 ♻️
- perf: 性能优化 ⚡
- test: 测试相关 ✅
- chore: 构建/依赖更新 🔧
- revert: 回滚提交 ⏪

### 规则
1. 提交信息使用中文
2. subject 简洁总结变更，20 字以内，不加句号
3. emoji 放在 subject 末尾
4. **不要写 body**。除非变更涉及 3 个以上独立模块且 subject 无法涵盖，才用 body 列出关键项（"- " 开头，最多 3 条）
5. 根据变更选择最合适的 type 和 emoji

### 示例
\`\`\`
feat: 添加用户登录功能 ✨
\`\`\`
\`\`\`
fix: 修复首页白屏问题 🐛
\`\`\`
\`\`\`
chore: 升级依赖版本 🔧
\`\`\`
\`\`\`
refactor: 重构用户模块 ♻️
- 拆分认证逻辑为独立服务
- 提取公共权限校验函数
- 统一错误处理策略
\`\`\``

const MAX_DIFF_LINES = 500

function truncateDiff(diff: string): string {
	const lines = diff.split('\n')
	if (lines.length <= MAX_DIFF_LINES) return diff
	return (
		lines.slice(0, MAX_DIFF_LINES).join('\n') +
		`\n\n... (truncated, ${lines.length - MAX_DIFF_LINES} more lines omitted)`
	)
}

export const OpencodeCommitPlugin: Plugin = async (ctx: PluginInput) => {
	return {
		config: async (config) => {
			config.command = config.command || {}
			config.command['commit'] = {
				description: '根据变更内容生成中文提交信息，确认后提交',
				template:
					'调用 commit-message-generate 获取变更和格式指南，生成一条中文提交信息。' +
					'绝大多数情况只需一行 subject，不要生成 body。' +
					'然后用 question 工具让用户确认：' +
					'1. question 内容为 "确认提交以下信息？\\n\\n<完整提交信息>"；' +
					'2. 设置 custom: true；' +
					'3. 选项：确认提交、取消。' +
					'用户确认后调用 commit-message-confirm 提交。',
				subtask: true,
			}
		},

		tool: {
			'commit-message-generate': tool({
				description:
					'收集当前仓库的 git diff、status 和最近提交历史，并附上中文约定式提交格式指南。如果没有暂存的变更，会自动暂存所有变更。',
				args: {},
				async execute(_args, context) {
					context.metadata({ title: '📦 收集 Git 上下文...' })
					let gitContext = ''
					try {
						const stat = await $`git diff --cached --stat`.text()
						if (!stat.trim()) {
							await $`git add -A`
							context.metadata({ title: '📦 自动暂存变更...' })
						}

						const diff = truncateDiff(await $`git diff --cached`.text())
						if (diff.trim()) {
							gitContext = `## Staged Changes\n\n\`\`\`diff\n${diff}\n\`\`\``
						} else {
							return '> 没有需要提交的变更。'
						}

						const status = await $`git status --short`.text()
						if (status.trim()) {
							gitContext += `\n\n## Git Status\n\n\`\`\`\n${status}\n\`\`\``
						}

						const log = await $`git log --oneline -5`.text()
						if (log.trim()) {
							gitContext += `\n\n## Recent Commits\n\n\`\`\`\n${log}\n\`\`\``
						}

						gitContext += `\n\n${COMMIT_GUIDE}`
					} catch (e: any) {
						const msg = String(e.message || e)
						if (msg.includes('not a git repository')) {
							return '> 当前目录不是 Git 仓库，无法收集上下文。'
						}
						return `> 收集 Git 上下文失败：${msg}`
					}

					return gitContext
				},
			}),

			'commit-message-confirm': tool({
				description: '使用指定的提交信息提交暂存的变更。仅在用户确认后才调用此工具。',
				args: {
					message: tool.schema.string().describe('中文约定式提交信息，含 emoji'),
				},
				async execute(args, context) {
					context.metadata({ title: `🚀 ${args.message}` })
					try {
						const result = await $`git commit -m ${args.message}`.text()
						const hash = await $`git rev-parse --short HEAD`.text()
						const branch = await $`git branch --show-current`.text()
						context.metadata({
							title: `✅ ${args.message}`,
							metadata: { branch: branch.trim(), hash: hash.trim() },
						})
						return {
							output: `✅ 提交成功！\n- 分支: ${branch.trim()}\n- Hash: ${hash.trim()}\n\n${result}`,
							metadata: { branch: branch.trim(), hash: hash.trim() },
						}
					} catch (e: any) {
						const msg = String(e.message || e)
						if (msg.includes('nothing to commit')) {
							return '> 没有需要提交的变更。'
						}
						if (msg.includes('pre-commit') || msg.includes('hook')) {
							return `> Pre-commit hook 失败：${msg}`
						}
						return `> 提交失败：${msg}`
					}
				},
			}),
		},
	}
}
