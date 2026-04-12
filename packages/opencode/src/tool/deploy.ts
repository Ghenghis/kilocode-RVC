// kilocode_change - infrastructure agent deployment pipeline tool
import z from "zod"
import { spawn } from "child_process"
import { StringDecoder } from "string_decoder"
import { Tool } from "./tool"
import DESCRIPTION from "./deploy.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Shell } from "@/shell/shell"

const DEFAULT_TIMEOUT = 300_000 // 5 minutes for deploy operations
const MAX_METADATA_LENGTH = 30_000

const log = Log.create({ service: "deploy-tool" })

const DEPLOY_ACTIONS = ["deploy", "rollback", "status", "health-check"] as const

// kilocode_change - validate host format for deployment target
const DANGEROUS_CHARS = /[`$(){}|;&<>!]/
const HOST_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/

function validateHost(host: string): void {
  if (DANGEROUS_CHARS.test(host)) {
    throw new Error(
      `Invalid deploy host: "${host}" contains dangerous characters. Expected user@hostname format.`,
    )
  }
  if (!HOST_PATTERN.test(host)) {
    throw new Error(`Invalid deploy host: "${host}". Expected user@hostname (e.g., deploy@production.example.com).`)
  }
}

// kilocode_change - validate remote path to prevent injection
function validatePath(remotePath: string): void {
  if (DANGEROUS_CHARS.test(remotePath)) {
    throw new Error(`Invalid remote path: "${remotePath}" contains dangerous characters.`)
  }
  if (!remotePath.startsWith("/")) {
    throw new Error(`Remote path must be absolute (start with /). Got: "${remotePath}"`)
  }
}

// kilocode_change - validate command strings (buildCommand / restartCommand)
// Rejects obvious shell injection attempts while allowing normal commands.
// These commands are also shown to the user via ctx.ask() for approval.
const COMMAND_INJECTION_CHARS = /[`$(){}]/
function validateCommand(command: string, label: string): void {
  if (COMMAND_INJECTION_CHARS.test(command)) {
    throw new Error(
      `Invalid ${label}: "${command}" contains potentially dangerous characters (backticks, $, parentheses, braces). ` +
        `Use simple commands like "npm run build" or "pm2 restart app".`,
    )
  }
}

interface StepResult {
  step: string
  success: boolean
  output: string
  durationMs: number
}

// kilocode_change - execute a command and capture output, matching bash tool spawn pattern
async function execCommand(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string
    env?: Record<string, string | undefined>
    timeout?: number
    abort: AbortSignal
  },
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  const proc = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  let output = ""
  const stdoutDecoder = new StringDecoder("utf8")
  const stderrDecoder = new StringDecoder("utf8")

  proc.stdout?.on("data", (chunk: Buffer) => {
    output += stdoutDecoder.write(chunk)
  })
  proc.stderr?.on("data", (chunk: Buffer) => {
    output += stderrDecoder.write(chunk)
  })

  let timedOut = false
  let aborted = false
  let exited = false

  const kill = () => Shell.killTree(proc, { exited: () => exited })

  if (opts.abort.aborted) {
    aborted = true
    await kill()
  }

  const abortHandler = () => {
    aborted = true
    void kill()
  }

  opts.abort.addEventListener("abort", abortHandler, { once: true })

  const timeout = opts.timeout ?? DEFAULT_TIMEOUT
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    void kill()
  }, timeout + 100)

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutTimer)
      opts.abort.removeEventListener("abort", abortHandler)
    }

    proc.once("close", () => {
      exited = true
      cleanup()
      resolve()
    })

    proc.once("error", (error) => {
      exited = true
      cleanup()
      reject(error)
    })
  })

  output += stdoutDecoder.end()
  output += stderrDecoder.end()

  if (aborted) {
    output += "\nAborted by user."
  }

  return { exitCode: proc.exitCode, output, timedOut }
}

// kilocode_change - execute a command on a remote host via SSH
async function sshExec(
  host: string,
  command: string,
  abort: AbortSignal,
  timeout?: number,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  return execCommand(
    "ssh",
    ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", host, command],
    { abort, timeout },
  )
}

async function runDeploy(
  params: {
    host: string
    path: string
    buildCommand?: string
    restartCommand?: string
    healthUrl?: string
  },
  ctx: Tool.Context,
): Promise<{ steps: StepResult[]; output: string }> {
  const steps: StepResult[] = []
  let fullOutput = ""

  const addStep = (result: StepResult) => {
    steps.push(result)
    fullOutput += `\n--- ${result.step} ---\n${result.output}\n`
    ctx.metadata({
      metadata: {
        output: fullOutput.length > MAX_METADATA_LENGTH ? fullOutput.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : fullOutput,
        currentStep: result.step,
        success: result.success,
      },
    })
  }

  // Step 1: Local build (if buildCommand provided)
  if (params.buildCommand) {
    const buildStart = Date.now()
    log.info("deploy: running build", { command: params.buildCommand })

    const shell = process.platform === "win32" ? "cmd" : "/bin/sh"
    const shellFlag = process.platform === "win32" ? "/c" : "-c"

    const result = await execCommand(shell, [shellFlag, params.buildCommand], {
      cwd: Instance.directory,
      abort: ctx.abort,
      timeout: DEFAULT_TIMEOUT,
    })

    addStep({
      step: "build",
      success: result.exitCode === 0,
      output: result.output || "(no output)",
      durationMs: Date.now() - buildStart,
    })

    if (result.exitCode !== 0) {
      fullOutput += "\nDeploy aborted: build step failed."
      return { steps, output: fullOutput }
    }
  }

  // Step 2: Create release directory and sync files
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const releaseDir = `${params.path}/releases/${timestamp}`

  const mkdirStart = Date.now()
  log.info("deploy: creating release directory", { releaseDir })

  const mkdirResult = await sshExec(params.host, `mkdir -p ${releaseDir}`, ctx.abort)

  addStep({
    step: "create-release-dir",
    success: mkdirResult.exitCode === 0,
    output: mkdirResult.output || `Created ${releaseDir}`,
    durationMs: Date.now() - mkdirStart,
  })

  if (mkdirResult.exitCode !== 0) {
    fullOutput += "\nDeploy aborted: failed to create release directory."
    return { steps, output: fullOutput }
  }

  // Step 3: Rsync files to remote
  const rsyncStart = Date.now()
  log.info("deploy: syncing files", { host: params.host, releaseDir })

  const rsyncResult = await execCommand(
    "rsync",
    [
      "-az",
      "--delete",
      "--exclude",
      ".git",
      "--exclude",
      "node_modules",
      `${Instance.directory}/`,
      `${params.host}:${releaseDir}/`,
    ],
    { abort: ctx.abort, timeout: DEFAULT_TIMEOUT },
  )

  addStep({
    step: "sync-files",
    success: rsyncResult.exitCode === 0,
    output: rsyncResult.output || "Files synced successfully.",
    durationMs: Date.now() - rsyncStart,
  })

  if (rsyncResult.exitCode !== 0) {
    fullOutput += "\nDeploy aborted: file sync failed."
    return { steps, output: fullOutput }
  }

  // Step 4: Update symlink to current release
  const symlinkStart = Date.now()
  log.info("deploy: updating current symlink", { releaseDir })

  const symlinkCmd = `ln -sfn ${releaseDir} ${params.path}/current`
  const symlinkResult = await sshExec(params.host, symlinkCmd, ctx.abort)

  addStep({
    step: "update-symlink",
    success: symlinkResult.exitCode === 0,
    output: symlinkResult.output || `Symlinked ${params.path}/current -> ${releaseDir}`,
    durationMs: Date.now() - symlinkStart,
  })

  if (symlinkResult.exitCode !== 0) {
    fullOutput += "\nDeploy aborted: symlink update failed."
    return { steps, output: fullOutput }
  }

  // Step 5: Restart service (if restartCommand provided)
  if (params.restartCommand) {
    const restartStart = Date.now()
    log.info("deploy: restarting service", { command: params.restartCommand })

    const restartResult = await sshExec(params.host, params.restartCommand, ctx.abort)

    addStep({
      step: "restart-service",
      success: restartResult.exitCode === 0,
      output: restartResult.output || "Service restarted.",
      durationMs: Date.now() - restartStart,
    })

    if (restartResult.exitCode !== 0) {
      fullOutput += "\nWarning: service restart failed. Deployment files are in place but service may not be running."
    }
  }

  // Step 6: Health check (if healthUrl provided)
  if (params.healthUrl) {
    const healthResult = await runHealthCheck(params.healthUrl, ctx.abort)
    addStep(healthResult)
  }

  return { steps, output: fullOutput }
}

async function runRollback(
  params: { host: string; path: string; restartCommand?: string },
  ctx: Tool.Context,
): Promise<{ steps: StepResult[]; output: string }> {
  const steps: StepResult[] = []
  let fullOutput = ""

  const addStep = (result: StepResult) => {
    steps.push(result)
    fullOutput += `\n--- ${result.step} ---\n${result.output}\n`
  }

  // Step 1: Find previous release
  const findStart = Date.now()
  log.info("deploy: finding previous release for rollback")

  const findResult = await sshExec(
    params.host,
    `ls -1t ${params.path}/releases/ | head -2`,
    ctx.abort,
  )

  const releases = findResult.output.trim().split("\n").filter((l) => l.length > 0)

  if (releases.length < 2) {
    addStep({
      step: "find-previous-release",
      success: false,
      output: `Only ${releases.length} release(s) found. Need at least 2 for rollback.\n${findResult.output}`,
      durationMs: Date.now() - findStart,
    })
    fullOutput += "\nRollback aborted: no previous release available."
    return { steps, output: fullOutput }
  }

  const previousRelease = releases[1]
  const previousDir = `${params.path}/releases/${previousRelease}`

  addStep({
    step: "find-previous-release",
    success: true,
    output: `Previous release: ${previousRelease}`,
    durationMs: Date.now() - findStart,
  })

  // Step 2: Update symlink to previous release
  const symlinkStart = Date.now()
  log.info("deploy: rolling back symlink", { previousDir })

  const symlinkCmd = `ln -sfn ${previousDir} ${params.path}/current`
  const symlinkResult = await sshExec(params.host, symlinkCmd, ctx.abort)

  addStep({
    step: "rollback-symlink",
    success: symlinkResult.exitCode === 0,
    output: symlinkResult.output || `Symlinked ${params.path}/current -> ${previousDir}`,
    durationMs: Date.now() - symlinkStart,
  })

  if (symlinkResult.exitCode !== 0) {
    fullOutput += "\nRollback aborted: symlink update failed."
    return { steps, output: fullOutput }
  }

  // Step 3: Restart service (if restartCommand provided)
  if (params.restartCommand) {
    const restartStart = Date.now()
    const restartResult = await sshExec(params.host, params.restartCommand, ctx.abort)

    addStep({
      step: "restart-service",
      success: restartResult.exitCode === 0,
      output: restartResult.output || "Service restarted.",
      durationMs: Date.now() - restartStart,
    })
  }

  return { steps, output: fullOutput }
}

async function runStatus(
  params: { host: string; path: string; restartCommand?: string },
  ctx: Tool.Context,
): Promise<{ steps: StepResult[]; output: string }> {
  const steps: StepResult[] = []
  let fullOutput = ""

  const addStep = (result: StepResult) => {
    steps.push(result)
    fullOutput += `\n--- ${result.step} ---\n${result.output}\n`
  }

  // Step 1: Check current symlink
  const symlinkStart = Date.now()
  const symlinkResult = await sshExec(params.host, `readlink -f ${params.path}/current`, ctx.abort)

  addStep({
    step: "current-release",
    success: symlinkResult.exitCode === 0,
    output: symlinkResult.output.trim() || "No current release symlink found.",
    durationMs: Date.now() - symlinkStart,
  })

  // Step 2: List releases
  const listStart = Date.now()
  const listResult = await sshExec(params.host, `ls -1t ${params.path}/releases/ 2>/dev/null | head -10`, ctx.abort)

  addStep({
    step: "available-releases",
    success: listResult.exitCode === 0,
    output: listResult.output.trim() || "No releases found.",
    durationMs: Date.now() - listStart,
  })

  // Step 3: Check service status
  if (params.restartCommand) {
    const statusStart = Date.now()
    // Try to derive a status command from the restart command
    const statusCmd = params.restartCommand
      .replace(/\brestart\b/, "status")
      .replace(/\breload\b/, "status")

    const statusResult = await sshExec(params.host, statusCmd, ctx.abort)

    addStep({
      step: "service-status",
      success: statusResult.exitCode === 0,
      output: statusResult.output.trim() || "No status output.",
      durationMs: Date.now() - statusStart,
    })
  }

  return { steps, output: fullOutput }
}

async function runHealthCheck(healthUrl: string, abort: AbortSignal): Promise<StepResult> {
  const healthStart = Date.now()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    // Abort if parent abort fires
    const abortHandler = () => controller.abort()
    abort.addEventListener("abort", abortHandler, { once: true })

    const response = await fetch(healthUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "kilocode-deploy-health-check" },
    })

    clearTimeout(timeoutId)
    abort.removeEventListener("abort", abortHandler)

    const body = await response.text().catch(() => "")
    const success = response.status >= 200 && response.status < 300

    return {
      step: "health-check",
      success,
      output: `HTTP ${response.status} ${response.statusText}\n${body.slice(0, 1000)}`,
      durationMs: Date.now() - healthStart,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      step: "health-check",
      success: false,
      output: `Health check failed: ${message}`,
      durationMs: Date.now() - healthStart,
    }
  }
}

export const DeployTool = Tool.define("deploy", () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      action: z.enum(DEPLOY_ACTIONS).describe("The deployment operation to perform"),
      host: z.string().describe("Target server in user@host format"),
      path: z.string().describe("Remote deployment path (e.g., /var/www/myapp)"),
      buildCommand: z.string().optional().describe("Local build command to run before deploying"),
      restartCommand: z
        .string()
        .optional()
        .describe("Service restart command on the remote server (e.g., pm2 restart app)"),
      healthUrl: z.string().optional().describe("HTTP endpoint URL for health check verification"),
    }),
    async execute(params, ctx) {
      const startTime = Date.now()

      // Validate inputs — kilocode_change: also validate command strings
      validateHost(params.host)
      validatePath(params.path)
      if (params.buildCommand) validateCommand(params.buildCommand, "buildCommand")
      if (params.restartCommand) validateCommand(params.restartCommand, "restartCommand")

      log.info("deploy execute", { action: params.action, host: params.host, path: params.path })

      // Ask for permission
      await ctx.ask({
        permission: "deploy",
        patterns: [`deploy ${params.action} ${params.host}:${params.path}`],
        always: [`deploy ${params.action} ${params.host}:*`],
        metadata: {
          action: params.action,
          host: params.host,
          path: params.path,
        },
      })

      let result: { steps: StepResult[]; output: string }

      switch (params.action) {
        case "deploy":
          result = await runDeploy(params, ctx)
          break
        case "rollback":
          result = await runRollback(params, ctx)
          break
        case "status":
          result = await runStatus(params, ctx)
          break
        case "health-check": {
          if (!params.healthUrl) {
            throw new Error("The health-check action requires a healthUrl parameter.")
          }
          const healthResult = await runHealthCheck(params.healthUrl, ctx.abort)
          result = {
            steps: [healthResult],
            output: `\n--- ${healthResult.step} ---\n${healthResult.output}\n`,
          }
          break
        }
      }

      const durationMs = Date.now() - startTime
      const allPassed = result.steps.every((s) => s.success)

      let output = `Deploy ${params.action} ${allPassed ? "succeeded" : "failed"} (${durationMs}ms)\n`
      output += result.output

      return {
        title: `Deploy: ${params.action} ${params.host}:${params.path}`,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          action: params.action,
          host: params.host,
          path: params.path,
          steps: result.steps.map((s) => ({ step: s.step, success: s.success, durationMs: s.durationMs })),
          exitCode: allPassed ? 0 : 1,
          durationMs,
        },
        output,
      }
    },
  }
})
