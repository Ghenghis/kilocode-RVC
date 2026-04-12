// kilocode_change - infrastructure agent SSH connection manager tool
import z from "zod"
import { spawn } from "child_process"
import { StringDecoder } from "string_decoder"
import { Tool } from "./tool"
import DESCRIPTION from "./ssh.txt"
import { Log } from "../util/log"
import { Shell } from "@/shell/shell"

const DEFAULT_TIMEOUT = 60_000
const CONNECT_TIMEOUT = 10
const MAX_METADATA_LENGTH = 30_000

const log = Log.create({ service: "ssh-tool" })

// kilocode_change - validate host format: must be user@hostname, no backticks or shell metacharacters
const HOST_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/
const DANGEROUS_HOST_CHARS = /[`$(){}|;&<>!]/

function validateHost(host: string): { user: string; hostname: string; portFromHost?: number } {
  // Strip port suffix if present (user@host:port)
  let portFromHost: number | undefined
  let cleanHost = host
  const portMatch = host.match(/^(.+):(\d+)$/)
  if (portMatch) {
    cleanHost = portMatch[1]
    portFromHost = parseInt(portMatch[2], 10)
    if (portFromHost < 1 || portFromHost > 65535) {
      throw new Error(`Invalid port number: ${portFromHost}. Must be between 1 and 65535.`)
    }
  }

  if (DANGEROUS_HOST_CHARS.test(cleanHost)) {
    throw new Error(
      `Invalid host format: "${host}" contains dangerous characters. Host must be in user@hostname format.`,
    )
  }

  if (!HOST_PATTERN.test(cleanHost)) {
    throw new Error(`Invalid host format: "${host}". Expected user@hostname (e.g., deploy@192.168.1.10).`)
  }

  const [user, hostname] = cleanHost.split("@")
  return { user, hostname, portFromHost }
}

export const SshTool = Tool.define("ssh", () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      host: z.string().describe("Remote host in user@host or user@host:port format"),
      command: z.string().describe("Command to execute on the remote server"),
      keyFile: z.string().optional().describe("Path to SSH private key file"),
      timeout: z
        .number()
        .optional()
        .describe(`Command timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`),
      port: z.number().optional().describe("SSH port override (default: 22)"),
    }),
    async execute(params, ctx) {
      const startTime = Date.now()

      // Validate host format before doing anything
      const { user, hostname, portFromHost } = validateHost(params.host)
      const effectivePort = params.port ?? portFromHost

      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      log.info("ssh execute", { host: params.host, port: effectivePort, hasKey: !!params.keyFile })

      // Ask for permission
      await ctx.ask({
        permission: "ssh",
        patterns: [`${user}@${hostname}`],
        always: [`${user}@${hostname} *`],
        metadata: {
          host: params.host,
          command: params.command,
        },
      })

      // Build SSH command arguments
      const sshArgs: string[] = [
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        `ConnectTimeout=${CONNECT_TIMEOUT}`,
        "-o",
        "BatchMode=yes",
      ]

      if (params.keyFile) {
        sshArgs.push("-i", params.keyFile)
      }

      if (effectivePort) {
        sshArgs.push("-p", String(effectivePort))
      }

      sshArgs.push(`${user}@${hostname}`)
      sshArgs.push(params.command)

      log.info("ssh spawn", { args: sshArgs })

      const proc = spawn("ssh", sshArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })

      let output = ""

      ctx.metadata({
        metadata: {
          output: "",
          host: params.host,
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
            host: params.host,
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
        resultMetadata.push(`SSH command timed out after ${timeout}ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the SSH command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<ssh_metadata>\n" + resultMetadata.join("\n") + "\n</ssh_metadata>"
      }

      return {
        title: `SSH: ${user}@${hostname}`,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          host: params.host,
          exitCode: proc.exitCode,
          durationMs,
        },
        output,
      }
    },
  }
})
