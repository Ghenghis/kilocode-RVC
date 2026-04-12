// kilocode_change - infrastructure agent Docker management tool
import z from "zod"
import { spawn } from "child_process"
import { StringDecoder } from "string_decoder"
import { Tool } from "./tool"
import DESCRIPTION from "./docker.txt"
import { Log } from "../util/log"
import { Shell } from "@/shell/shell"

const DEFAULT_TIMEOUT = 120_000
const MAX_METADATA_LENGTH = 30_000

const log = Log.create({ service: "docker-tool" })

const DOCKER_ACTIONS = [
  "run",
  "stop",
  "restart",
  "rm",
  "logs",
  "exec",
  "inspect",
  "ps",
  "build",
  "pull",
  "push",
  "compose-up",
  "compose-down",
  "compose-ps",
  "compose-logs",
] as const

type DockerAction = (typeof DOCKER_ACTIONS)[number]

// kilocode_change - validate host string for remote docker, prevent injection
const DANGEROUS_CHARS = /[`$(){}|;&<>!]/

function validateDockerHost(host: string): void {
  if (DANGEROUS_CHARS.test(host)) {
    throw new Error(
      `Invalid Docker host: "${host}" contains dangerous characters. Expected user@hostname format.`,
    )
  }
}

// kilocode_change - split options string into argv array, respecting quoted values
function splitOptions(options: string): string[] {
  const args: string[] = []
  let current = ""
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < options.length; i++) {
    const ch = options[i]

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) {
    args.push(current)
  }
  return args
}

function buildDockerArgs(action: DockerAction, target: string, options?: string, command?: string): string[] {
  const args: string[] = []
  const optionArgs = options ? splitOptions(options) : []

  switch (action) {
    // Container operations
    case "run":
      args.push("run", ...optionArgs, target)
      if (command) args.push(...splitOptions(command))
      break

    case "stop":
      args.push("stop", ...optionArgs, target)
      break

    case "restart":
      args.push("restart", ...optionArgs, target)
      break

    case "rm":
      args.push("rm", ...optionArgs, target)
      break

    case "logs":
      // Default to last 100 lines unless overridden by options
      if (!options || (!options.includes("--tail") && !options.includes("-n") && !options.includes("--follow"))) {
        args.push("logs", "--tail", "100", ...optionArgs, target)
      } else {
        args.push("logs", ...optionArgs, target)
      }
      break

    case "exec":
      if (!command) {
        throw new Error('The "exec" action requires a command parameter.')
      }
      args.push("exec", ...optionArgs, target, ...splitOptions(command))
      break

    case "inspect":
      args.push("inspect", ...optionArgs, target)
      break

    case "ps":
      args.push("ps", ...optionArgs)
      break

    // Image operations
    case "build":
      args.push("build", ...optionArgs, target)
      break

    case "pull":
      args.push("pull", ...optionArgs, target)
      break

    case "push":
      args.push("push", ...optionArgs, target)
      break

    // Compose operations
    case "compose-up":
      args.push("compose", "-f", target, "up", ...optionArgs)
      break

    case "compose-down":
      args.push("compose", "-f", target, "down", ...optionArgs)
      break

    case "compose-ps":
      args.push("compose", "-f", target, "ps", ...optionArgs)
      break

    case "compose-logs":
      args.push("compose", "-f", target, "logs", ...optionArgs)
      break
  }

  return args
}

export const DockerTool = Tool.define("docker", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      action: z.enum(DOCKER_ACTIONS).describe("The Docker operation to perform"),
      target: z.string().describe("Container name/ID, image name, or compose file path"),
      options: z.string().optional().describe("Additional CLI flags"),
      command: z.string().optional().describe("Command to execute (for exec and run actions)"),
      host: z.string().optional().describe("Remote Docker host (user@server for SSH-based access)"),
    }),
    async execute(params, ctx) {
      const startTime = Date.now()

      // Validate remote host if specified
      if (params.host) {
        validateDockerHost(params.host)
      }

      log.info("docker execute", { action: params.action, target: params.target, host: params.host })

      // Ask for permission
      await ctx.ask({
        permission: "docker",
        patterns: [`docker ${params.action} ${params.target}`],
        always: [`docker ${params.action} *`],
        metadata: {
          action: params.action,
          target: params.target,
          host: params.host,
        },
      })

      const dockerArgs = buildDockerArgs(params.action, params.target, params.options, params.command)

      log.info("docker spawn", { args: dockerArgs })

      const env: Record<string, string | undefined> = { ...process.env }
      if (params.host) {
        env.DOCKER_HOST = `ssh://${params.host}`
      }

      const proc = spawn("docker", dockerArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
        windowsHide: true,
      })

      let output = ""

      ctx.metadata({
        metadata: {
          output: "",
          action: params.action,
          target: params.target,
        },
      })

      // Use StringDecoder to handle multi-byte UTF-8 characters split across chunks
      const stdoutDecoder = new StringDecoder("utf8")
      const stderrDecoder = new StringDecoder("utf8")
      const append = (decoder: StringDecoder) => (chunk: Buffer) => {
        output += decoder.write(chunk)
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            action: params.action,
            target: params.target,
          },
        })
      }

      proc.stdout?.on("data", append(stdoutDecoder))
      proc.stderr?.on("data", append(stderrDecoder))

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeout = DEFAULT_TIMEOUT
      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
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

      // Flush any trailing buffered bytes from decoders
      output += stdoutDecoder.end()
      output += stderrDecoder.end()

      const durationMs = Date.now() - startTime

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`Docker command timed out after ${timeout}ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the Docker command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<docker_metadata>\n" + resultMetadata.join("\n") + "\n</docker_metadata>"
      }

      return {
        title: `Docker: ${params.action} ${params.target}`,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          action: params.action,
          target: params.target,
          exitCode: proc.exitCode,
          durationMs,
        },
        output,
      }
    },
  }
})
