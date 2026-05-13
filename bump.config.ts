import { defineConfig } from 'bumpp'

export default defineConfig({
  commit: 'chore: release v%s',
  tag: false,
  push: true,
  execute: 'sh -c "bun run build && npm publish"',
})
