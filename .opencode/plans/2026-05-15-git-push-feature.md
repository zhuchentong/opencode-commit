# Git Push 功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 commit 成功后询问用户是否需要执行 git push，并新增独立的 git-push 工具

**Architecture:** 新增 `createPushTool` 工具处理 git push 逻辑，在 `/commit` 命令模板末尾追加 push 询问流程，仅在检测到存在 git remote 时才询问

**Tech Stack:** TypeScript, OpenCode Plugin SDK, Bun Shell

---

### 文件变更概览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/tools.ts` | 修改 | 新增 `createPushTool` 函数和导出 |
| `src/index.ts` | 修改 | 注册 `git-push` 工具，扩展 `/commit` template |

---

### Task 1: 新增 git-push 工具

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: 在 `src/tools.ts` 末尾添加 `createPushTool` 函数**

```typescript
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
```

- [ ] **Step 2: 运行类型检查验证**

```bash
bun typecheck
```

Expected: 无类型错误

---

### Task 2: 注册 git-push 工具并扩展 /commit 模板

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 在 `src/index.ts` 的 import 中添加 `createPushTool`**

```typescript
import {
  createAmendTool,
  createConfirmTool,
  createDiffTool,
  createGenerateTool,
  createLogTool,
  createPushTool,  // 新增
  createStatusTool,
  createUndoTool,
  createValidateTool,
} from './tools.js'
```

- [ ] **Step 2: 在 tool 对象中注册 git-push 工具**

在 `tool` 对象中添加（放在 `git-undo` 之后）：

```typescript
tool: {
  'commit-message-generate': createGenerateTool(ctx.$, commitConfig),
  'commit-message-validate': createValidateTool(commitConfig),
  'commit-message-confirm': createConfirmTool(ctx.$, commitConfig),
  'git-amend': createAmendTool(ctx.$, commitConfig),
  'git-diff': createDiffTool(ctx.$),
  'git-log': createLogTool(ctx.$),
  'git-status': createStatusTool(ctx.$),
  'git-undo': createUndoTool(ctx.$),
  'git-push': createPushTool(ctx.$),  // 新增
},
```

- [ ] **Step 3: 扩展 /commit template，在末尾追加 push 询问逻辑**

修改 `cfg.command['commit'].template` 的最后一句，将：

```
'用户确认后调用 commit-message-confirm 提交。'
```

替换为：

```
'用户确认后调用 commit-message-confirm 提交。' +
'提交成功后，调用 git remote 检查是否存在远程仓库。' +
'如果存在远程仓库（git remote 输出非空），用 question 工具询问用户："提交成功，是否需要执行 git push？"' +
'设置 custom: true，选项：执行 push、不需要。' +
'用户选择"执行 push"时调用 git-push 工具。'
```

- [ ] **Step 4: 运行类型检查验证**

```bash
bun typecheck
```

Expected: 无类型错误

---

### Task 3: 提交变更

- [ ] **Step 1: 暂存并提交**

```bash
git add -A && git commit -m "feat: 🚀 添加 git push 工具及 commit 后推送询问"
```
