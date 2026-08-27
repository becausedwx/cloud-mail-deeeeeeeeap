#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const vueDir = join(repoRoot, 'mail-vue')
const workerDir = resolve(process.env.CLOUD_MAIL_WORKER_TEST_DIR || join(repoRoot, 'mail-worker'))
const executableSuffix = process.platform === 'win32' ? '.cmd' : ''

function localExecutable(projectDir, name) {
  return join(projectDir, 'node_modules', '.bin', `${name}${executableSuffix}`)
}

const frontendTests = readdirSync(join(vueDir, 'test'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => join('test', name))

const steps = [
  {
    id: 'release-config-tests',
    cwd: repoRoot,
    command: process.execPath,
    args: ['--test', join('scripts', 'verify-release.test.mjs')]
  },
  {
    id: 'worker-tests',
    cwd: workerDir,
    command: localExecutable(workerDir, 'vitest'),
    args: ['run', '--no-file-parallelism', '--maxWorkers=1']
  },
  {
    id: 'frontend-tests',
    cwd: vueDir,
    command: process.execPath,
    args: ['--test', ...frontendTests]
  },
  {
    id: 'frontend-release-build',
    cwd: vueDir,
    command: localExecutable(vueDir, 'vite'),
    args: ['build', '--mode', 'release']
  }
]

// 部署只需要产出 dist；单元测试在 .github/workflows/ci.yml 上按 push 和 pull_request 跑，
// 在部署路径里重跑一遍是同一 commit 测两次。配置自检留着——它校验的正是 wrangler 各入口
// 和工作流本身，几秒钟就跑完，是唯一能挡住配置写错就上线的一步。
const DEPLOY_STEP_IDS = new Set(['release-config-tests', 'frontend-release-build'])
const deployOnly = process.argv.includes('--deploy')
const selectedSteps = deployOnly ? steps.filter(step => DEPLOY_STEP_IDS.has(step.id)) : steps

if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify(selectedSteps.map(step => ({
    id: step.id,
    cwd: relative(repoRoot, step.cwd),
    command: relative(repoRoot, step.command),
    args: step.args
  })), null, 2)}\n`)
  process.exit(0)
}

if (deployOnly) {
  console.log('[verify] deploy mode: skipping unit tests, they run in CI')
}

for (const step of selectedSteps) {
  if (!existsSync(step.command)) {
    console.error(`[verify] Missing executable for ${step.id}: ${step.command}`)
    process.exit(1)
  }

  console.log(`[verify] ${step.id}`)
  const command = process.platform === 'win32' && step.command.endsWith('.cmd')
    ? 'cmd.exe'
    : step.command
  const args = command === 'cmd.exe'
    ? ['/d', '/s', '/c', step.command, ...step.args]
    : step.args
  const result = spawnSync(command, args, {
    cwd: step.cwd,
    stdio: 'inherit'
  })

  if (result.error) {
    console.error(`[verify] ${step.id} failed to start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
