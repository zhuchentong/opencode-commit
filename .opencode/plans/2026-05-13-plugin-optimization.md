# 插件优化详细执行方案（修订版）

> 基于可行性分析，已修复：emoji 正则范围、变量遮蔽、.npmignore 遗漏等问题

**目标：** 将 opencode-commit 从单文件重构为模块化架构，新增验证、配置、错误处理和 git 工具集

**架构：** 拆分为 8 个模块，采用 Result 类型错误处理，提交信息验证管道，扩展 5 个 git 工具

**技术栈：** TypeScript, Bun, @opencode-ai/plugin@1.14.48, Zod@4.1.8 (SDK 内置)

---

## 文件变更总览

```
变更文件:
├── src/
│   ├── index.ts        # 重写 - 从 156 行精简为入口文件
│   ├── safe.ts         # 新建 - Result 类型工具
│   ├── errors.ts       # 新建 - CommitError 类
│   ├── config.ts       # 新建 - 配置加载系统
│   ├── parser.ts       # 新建 - 提交信息解析器
│   ├── validator.ts    # 新建 - 提交信息验证器
│   ├── guide.ts        # 新建 - COMMIT_GUIDE 常量
│   └── tools.ts        # 新建 - 7 个工具的工厂函数
├── opencode-commit.schema.json  # 新建 - 配置 JSON Schema
└── .npmignore          # 修改 - 新增 schema 文件排除

不变更:
├── scripts/dev.ts      # 无需修改
├── scripts/build.ts    # 无需修改 (Bun.build 自动处理 import graph)
├── package.json        # 无需修改 (zod 已通过 plugin SDK 引入)
└── tsconfig.json       # 无需修改
```

---

## Task 1: 创建 Result 类型工具

**文件:** `src/safe.ts` (新建)

```typescript
export type Result<T, E> =
  | { data: T; error: null }
  | { data: null; error: E }

type SafeResult<T> = Result<T, Error>

export const safe = <T>(fn: () => T): SafeResult<T> => {
  try {
    const data = fn()
    return { data, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

export const safeAsync = async <T>(fn: () => Promise<T>): Promise<SafeResult<T>> => {
  try {
    const data = await fn()
    return { data, error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
```

**验证:** `bun run typecheck`

---

## Task 2: 创建 CommitError 类

**文件:** `src/errors.ts` (新建)

```typescript
export class CommitError extends Error {
  constructor(message: string, public suggestions: string[] = []) {
    super(message)
  }
}
```

**验证:** `bun run typecheck`

---

## Task 3: 创建配置系统

**文件:** `src/config.ts` (新建)

**关键设计决策:**
- 使用 `tool.schema` (即 zod) 而非直接 `import { z } from 'zod'`，因为 zod 是 SDK 内部依赖
- 类型命名为 `CommitConfig`（避免与 SDK 的 `Config` 混淆）
- 配置文件: `opencode-commit.json`
- 无配置文件时静默使用默认值

```typescript
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tool } from '@opencode-ai/plugin'
import { safeAsync } from './safe.ts'

const z = tool.schema

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

export const DEFAULT_MAX_LENGTH = 72

const rawConfigSchema = z.object({
  types: z.array(z.string()).optional(),
  scopes: z.record(z.string(), z.array(z.string())).optional(),
  maxLength: z.number().optional(),
})

export type CommitConfig = {
  types: string[]
  scopes?: Record<string, string[]>
  maxLength: number
}

export const loadConfig = async (directory: string): Promise<CommitConfig> => {
  const configPath = join(directory, 'opencode-commit.json')

  const result = await safeAsync(async () => {
    const raw = await readFile(configPath, 'utf-8')
    return rawConfigSchema.parse(JSON.parse(raw))
  })

  if (result.error) {
    return {
      types: [...DEFAULT_TYPES],
      maxLength: DEFAULT_MAX_LENGTH,
    }
  }

  return {
    types: result.data.types ?? [...DEFAULT_TYPES],
    scopes: result.data.scopes,
    maxLength: result.data.maxLength ?? DEFAULT_MAX_LENGTH,
  }
}

export const getAllScopes = (config: CommitConfig): string[] | undefined => {
  if (!config.scopes) return undefined
  return Object.values(config.scopes).flat()
}
```

**验证:** `bun run typecheck`

---

## Task 4: 创建提交信息解析器

**文件:** `src/parser.ts` (新建)

**关键设计决策:**
- Emoji 匹配使用 `EMOJI_MAP` 值表查找 + 广泛 Unicode 范围双保险
- 中文错误信息 + 中文建议
- 支持带 scope 的提交信息 (如 `feat(ui): 添加按钮 ✨`)

```typescript
import { CommitError } from './errors.ts'

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
```

**验证:** `bun run typecheck`

---

## Task 5: 创建提交信息验证器

**文件:** `src/validator.ts` (新建)

**验证规则:**
1. 类型必须在配置允许的列表中
2. Scope 必须在配置允许的列表中（如果配置了）
3. 总长度不超过 maxLength

**注意:** 不检查 "描述首字母小写" 和 "不以标点结尾"，因为中文描述不适用英文规则。

```typescript
import type { CommitConfig } from './config.ts'
import { getAllScopes } from './config.ts'
import { CommitError } from './errors.ts'
import { parseCommitMessage } from './parser.ts'

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
```

**验证:** `bun run typecheck`

---

## Task 6: 提取 COMMIT_GUIDE 常量

**文件:** `src/guide.ts` (新建)

```typescript
export const COMMIT_GUIDE = `## 提交信息格式要求

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

export const MAX_DIFF_LINES = 500
```

**验证:** `bun run typecheck`

---

## Task 7: 创建工具定义

**文件:** `src/tools.ts` (新建)

**包含 7 个工具:**

| 工具名 | 功能 | 需要验证 | 需要配置 |
|--------|------|----------|----------|
| `commit-message-generate` | 收集 git 上下文 + 格式指南 | 否 | 是 |
| `commit-message-confirm` | 提交（带验证） | 是 | 是 |
| `git-amend` | 修改提交（带验证） | 是 | 是 |
| `git-diff` | 查看 diff | 否 | 否 |
| `git-log` | 查看提交历史 | 否 | 否 |
| `git-status` | 查看工作树状态 | 否 | 否 |
| `git-undo` | 撤销提交 | 否 | 否 |

```typescript
import type { PluginInput } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import type { CommitConfig } from './config.ts'
import { CommitError } from './errors.ts'
import { COMMIT_GUIDE, MAX_DIFF_LINES } from './guide.ts'
import { safe, safeAsync } from './safe.ts'
import { validateCommitMessage } from './validator.ts'

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

export const createGenerateTool = ($: BunShell, config: CommitConfig) => {
  return tool({
    description:
      '收集当前仓库的 git diff、status 和最近提交历史，并附上中文约定式提交格式指南。如果没有暂存的变更，会自动暂存所有变更。',
    args: {},
    async execute(_args, context) {
      context.metadata({ title: '📦 收集 Git 上下文...' })

      const statResult = await safeAsync(() => $`git diff --cached --stat`.text())
      if (statResult.error) {
        const msg = String(statResult.error.message || statResult.error)
        if (msg.includes('not a git repository')) {
          return '> 当前目录不是 Git 仓库，无法收集上下文。'
        }
        return `> 收集 Git 上下文失败：${msg}`
      }

      if (!statResult.data.trim()) {
        await safeAsync(() => $`git add -A`.text())
        context.metadata({ title: '📦 自动暂存变更...' })
      }

      const diffResult = await safeAsync(() => $`git diff --cached`.text())
      if (diffResult.error) {
        return `> 获取 diff 失败：${diffResult.error.message}`
      }

      const diff = truncateDiff(diffResult.data)
      if (!diff.trim()) {
        return '> 没有需要提交的变更。'
      }

      let gitContext = `## Staged Changes\n\n\`\`\`diff\n${diff}\n\`\`\``

      const statusResult = await safeAsync(() => $`git status --short`.text())
      if (statusResult.data?.trim()) {
        gitContext += `\n\n## Git Status\n\n\`\`\`\n${statusResult.data}\n\`\`\``
      }

      const logResult = await safeAsync(() => $`git log --oneline -5`.text())
      if (logResult.data?.trim()) {
        gitContext += `\n\n## Recent Commits\n\n\`\`\`\n${logResult.data}\n\`\`\``
      }

      gitContext += `\n\n${COMMIT_GUIDE}`
      return gitContext
    },
  })
}

export const createConfirmTool = ($: BunShell, config: CommitConfig) => {
  return tool({
    description: '使用指定的提交信息提交暂存的变更。仅在用户确认后才调用此工具。',
    args: {
      message: tool.schema.string().describe('中文约定式提交信息，含 emoji'),
    },
    async execute(args, context) {
      context.metadata({ title: `🚀 ${args.message}` })

      const validation = safe(() => validateCommitMessage(args.message, config))
      if (validation.error) {
        return formatValidationError(validation.error)
      }

      const result = await safeAsync(() => $`git commit -m ${args.message}`.text())
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

      context.metadata({
        title: `✅ ${args.message}`,
        metadata: { branch, hash },
      })

      return {
        output: `✅ 提交成功！\n- 分支: ${branch}\n- Hash: ${hash}\n\n${result.data}`,
        metadata: { branch, hash },
      }
    },
  })
}

export const createAmendTool = ($: BunShell, config: CommitConfig) => {
  return tool({
    description: '使用新的验证过的提交信息修改最后一次提交',
    args: {
      message: tool.schema.string().describe('新的中文约定式提交信息'),
    },
    async execute(args, context) {
      context.metadata({ title: `📝 修改提交: ${args.message}` })

      const validation = safe(() => validateCommitMessage(args.message, config))
      if (validation.error) {
        return formatValidationError(validation.error)
      }

      const result = await safeAsync(() => $`git commit --amend -m ${args.message}`.text())
      if (result.error) {
        return `> 修改提交失败：${result.error.message}`
      }

      const hashResult = await safeAsync(() => $`git rev-parse --short HEAD`.text())
      const branchResult = await safeAsync(() => $`git branch --show-current`.text())

      const hash = hashResult.data?.trim() ?? 'unknown'
      const branch = branchResult.data?.trim() ?? 'unknown'

      context.metadata({
        title: `✅ ${args.message}`,
        metadata: { branch, hash },
      })

      return {
        output: `✅ 修改成功！\n- 分支: ${branch}\n- Hash: ${hash}\n\n${result.data}`,
        metadata: { branch, hash },
      }
    },
  })
}

export const createDiffTool = ($: BunShell) => {
  return tool({
    description: '显示当前暂存的 diff',
    args: {
      staged: tool.schema.boolean().optional().describe('显示暂存的变更（默认: true）'),
    },
    async execute(args) {
      const flag = args.staged === false ? '' : '--staged'

      const result = await safeAsync(() => $`git diff ${flag}`.text())
      if (result.error) {
        return `> 获取 diff 失败：${result.error.message}`
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return flag ? '没有暂存的变更。' : '没有未暂存的变更。'
      }

      return `\`\`\`diff\n${trimmed}\n\`\`\``
    },
  })
}

export const createLogTool = ($: BunShell) => {
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

export const createStatusTool = ($: BunShell) => {
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

export const createUndoTool = ($: BunShell) => {
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
```

**验证:** `bun run typecheck`

---

## Task 8: 重写插件入口

**文件:** `src/index.ts` (重写)

**修复:** 变量遮蔽问题 - config hook 参数命名为 `cfg`

```typescript
import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { loadConfig } from './config.ts'
import {
  createAmendTool,
  createConfirmTool,
  createDiffTool,
  createGenerateTool,
  createLogTool,
  createStatusTool,
  createUndoTool,
} from './tools.ts'

export const OpencodeCommitPlugin: Plugin = async (ctx: PluginInput) => {
  const commitConfig = await loadConfig(ctx.directory)

  return {
    config: async (cfg) => {
      cfg.command = cfg.command || {}
      cfg.command['commit'] = {
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
      'commit-message-generate': createGenerateTool(ctx.$, commitConfig),
      'commit-message-confirm': createConfirmTool(ctx.$, commitConfig),
      'git-amend': createAmendTool(ctx.$, commitConfig),
      'git-diff': createDiffTool(ctx.$),
      'git-log': createLogTool(ctx.$),
      'git-status': createStatusTool(ctx.$),
      'git-undo': createUndoTool(ctx.$),
    },
  }
}
```

**验证:** `bun run typecheck`

---

## Task 9: 创建 JSON Schema

**文件:** `opencode-commit.schema.json` (新建)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "OpenCode Commit Plugin Configuration",
  "description": "opencode-commit 插件配置文件",
  "type": "object",
  "properties": {
    "types": {
      "type": "array",
      "items": { "type": "string" },
      "description": "允许的提交类型",
      "default": ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "revert"]
    },
    "scopes": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": { "type": "string" }
      },
      "description": "按类别分组的作用域白名单（不配置则不限制）"
    },
    "maxLength": {
      "type": "number",
      "description": "提交信息最大长度",
      "default": 72
    }
  },
  "additionalProperties": false
}
```

---

## Task 10: 更新 .npmignore

**文件:** `.npmignore` (修改)

新增一行，将 schema 文件排除在 npm 包之外（它是给开发时 IDE 用的，不需要发布）:

```
src/
scripts/
tsconfig.json
tsconfig.build.json
node_modules/
*.tgz
bun.lock
opencode-commit.schema.json
```

---

## Task 11: 最终验证

1. `bun run typecheck` - 类型检查
2. `bun run build` - 构建验证
3. `bun run dev` - 插件加载验证

---

## 执行顺序与依赖关系

```
Task 1 (safe.ts) ─────┐
Task 2 (errors.ts) ───┤
Task 6 (guide.ts) ────┤
                       ├──→ Task 3 (config.ts) ──→ Task 4 (parser.ts) ──→ Task 5 (validator.ts)
                       └──────────────────────────────────────────────────→ Task 7 (tools.ts)
                                                                          → Task 8 (index.ts)
Task 9 (schema.json) ─── 独立，可并行
Task 10 (.npmignore) ── 独立，可并行
Task 11 (验证) ──────── 依赖所有前置 Task
```

**建议并行分组:**
- **第一批 (并行):** Task 1, 2, 6, 9, 10 - 无依赖的基础文件
- **第二批:** Task 3 (依赖 Task 1)
- **第三批:** Task 4 (依赖 Task 2)
- **第四批:** Task 5 (依赖 Task 3, 4)
- **第五批:** Task 7 (依赖 Task 1-6)
- **第六批:** Task 8 (依赖 Task 7)
- **第七批:** Task 11 (依赖所有)
