// kilocode_change — Phase 8.6: VPS Provisioning Tool
// Cloud provider integrations via CLI: AWS, DigitalOcean, Hetzner, Linode, Vultr
import z from "zod"
import { spawn } from "child_process"
import { StringDecoder } from "string_decoder"
import { Tool } from "./tool"
import DESCRIPTION from "./vps.txt"
import { Log } from "../util/log"
import { Shell } from "@/shell/shell"

const DEFAULT_TIMEOUT = 120_000
const MAX_METADATA_LENGTH = 30_000

const log = Log.create({ service: "vps-tool" })

const VPS_ACTIONS = ["create", "destroy", "list", "status", "ssh", "snapshot"] as const
const VPS_PROVIDERS = ["aws", "digitalocean", "hetzner", "linode", "vultr"] as const

type VpsAction = (typeof VPS_ACTIONS)[number]
type VpsProvider = (typeof VPS_PROVIDERS)[number]

interface VpsParams {
  action: VpsAction
  provider: VpsProvider
  name: string
  region?: string
  size?: string
  image?: string
  sshKey?: string
  options?: string
}

// kilocode_change — split options string into argv array, respecting quoted values
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

// kilocode_change — returns { cli, args } — the CLI binary and its argument list
function buildVpsArgs(
  action: VpsAction,
  provider: VpsProvider,
  params: VpsParams,
): { cli: string; args: string[] } {
  const optionArgs = params.options ? splitOptions(params.options) : []

  switch (provider) {
    // ── AWS ──────────────────────────────────────────────────────────────────
    case "aws": {
      const cli = "aws"
      switch (action) {
        case "create": {
          const args = ["ec2", "run-instances", "--tag-specifications", `ResourceType=instance,Tags=[{Key=Name,Value=${params.name}}]`]
          if (params.image) args.push("--image-id", params.image)
          if (params.size) args.push("--instance-type", params.size)
          if (params.region) args.push("--region", params.region)
          if (params.sshKey) args.push("--key-name", params.sshKey)
          args.push(...optionArgs)
          return { cli, args }
        }
        case "destroy": {
          // Requires instance-id; user may supply it as name or via options
          const args = ["ec2", "terminate-instances", "--instance-ids", params.name, ...optionArgs]
          if (params.region) args.push("--region", params.region)
          return { cli, args }
        }
        case "list": {
          const args = ["ec2", "describe-instances", "--output", "table"]
          if (params.region) args.push("--region", params.region)
          if (params.name && params.name !== "*") {
            args.push("--filters", `Name=tag:Name,Values=${params.name}`)
          }
          args.push(...optionArgs)
          return { cli, args }
        }
        case "status": {
          const args = ["ec2", "describe-instances", "--filters", `Name=tag:Name,Values=${params.name}`, "--output", "table"]
          if (params.region) args.push("--region", params.region)
          args.push(...optionArgs)
          return { cli, args }
        }
        case "ssh": {
          // Return the SSH command string as output without executing
          const host = params.name
          const keyFlag = params.sshKey ? `-i ${params.sshKey} ` : ""
          return { cli: "__ssh_hint__", args: [`ssh ${keyFlag}ec2-user@${host}`] }
        }
        case "snapshot": {
          const args = ["ec2", "create-image", "--instance-id", params.name, "--name", `${params.name}-snapshot-${Date.now()}`]
          if (params.region) args.push("--region", params.region)
          args.push(...optionArgs)
          return { cli, args }
        }
      }
      break
    }

    // ── DigitalOcean ─────────────────────────────────────────────────────────
    case "digitalocean": {
      const cli = "doctl"
      switch (action) {
        case "create": {
          const args = ["compute", "droplet", "create", params.name]
          if (params.region) args.push("--region", params.region)
          if (params.size) args.push("--size", params.size)
          if (params.image) args.push("--image", params.image)
          if (params.sshKey) args.push("--ssh-keys", params.sshKey)
          args.push(...optionArgs)
          return { cli, args }
        }
        case "destroy": {
          const args = ["compute", "droplet", "delete", params.name, "--force", ...optionArgs]
          return { cli, args }
        }
        case "list": {
          const args = ["compute", "droplet", "list", ...optionArgs]
          if (params.name && params.name !== "*") args.push("--no-header")
          return { cli, args }
        }
        case "status": {
          const args = ["compute", "droplet", "get", params.name, ...optionArgs]
          return { cli, args }
        }
        case "ssh": {
          return { cli: "__ssh_hint__", args: [`doctl compute ssh ${params.name}`] }
        }
        case "snapshot": {
          const args = ["compute", "droplet-action", "snapshot", params.name, "--snapshot-name", `${params.name}-snapshot-${Date.now()}`, ...optionArgs]
          return { cli, args }
        }
      }
      break
    }

    // ── Hetzner ───────────────────────────────────────────────────────────────
    case "hetzner": {
      const cli = "hcloud"
      switch (action) {
        case "create": {
          const args = ["server", "create", "--name", params.name]
          if (params.size) args.push("--type", params.size)
          if (params.image) args.push("--image", params.image)
          if (params.region) args.push("--location", params.region)
          if (params.sshKey) args.push("--ssh-key", params.sshKey)
          args.push(...optionArgs)
          return { cli, args }
        }
        case "destroy": {
          const args = ["server", "delete", params.name, ...optionArgs]
          return { cli, args }
        }
        case "list": {
          const args = ["server", "list", ...optionArgs]
          return { cli, args }
        }
        case "status": {
          const args = ["server", "describe", params.name, ...optionArgs]
          return { cli, args }
        }
        case "ssh": {
          return { cli: "__ssh_hint__", args: [`hcloud server ssh ${params.name}`] }
        }
        case "snapshot": {
          const args = ["server", "create-image", "--type", "snapshot", "--description", `${params.name}-snapshot-${Date.now()}`, params.name, ...optionArgs]
          return { cli, args }
        }
      }
      break
    }

    // ── Linode ────────────────────────────────────────────────────────────────
    case "linode": {
      const cli = "linode-cli"
      switch (action) {
        case "create": {
          const args = ["linodes", "create", "--label", params.name]
          if (params.region) args.push("--region", params.region)
          if (params.size) args.push("--type", params.size)
          if (params.image) args.push("--image", params.image)
          if (params.sshKey) args.push("--authorized_keys", params.sshKey)
          args.push(...optionArgs)
          return { cli, args }
        }
        case "destroy": {
          const args = ["linodes", "delete", params.name, ...optionArgs]
          return { cli, args }
        }
        case "list": {
          const args = ["linodes", "list", ...optionArgs]
          return { cli, args }
        }
        case "status": {
          const args = ["linodes", "view", params.name, ...optionArgs]
          return { cli, args }
        }
        case "ssh": {
          return { cli: "__ssh_hint__", args: [`ssh root@$(linode-cli linodes view ${params.name} --format ipv4 --no-headers)`] }
        }
        case "snapshot": {
          const args = ["linodes", "snapshot", params.name, "--label", `${params.name}-snapshot-${Date.now()}`, ...optionArgs]
          return { cli, args }
        }
      }
      break
    }

    // ── Vultr ─────────────────────────────────────────────────────────────────
    case "vultr": {
      const cli = "vultr-cli"
      switch (action) {
        case "create": {
          const args = ["instance", "create", "--label", params.name]
          if (params.region) args.push("--region", params.region)
          if (params.size) args.push("--plan", params.size)
          if (params.image) args.push("--os", params.image)
          if (params.sshKey) args.push("--ssh-keys", params.sshKey)
          args.push(...optionArgs)
          return { cli, args }
        }
        case "destroy": {
          const args = ["instance", "delete", params.name, ...optionArgs]
          return { cli, args }
        }
        case "list": {
          const args = ["instance", "list", ...optionArgs]
          return { cli, args }
        }
        case "status": {
          const args = ["instance", "get", params.name, ...optionArgs]
          return { cli, args }
        }
        case "ssh": {
          return { cli: "__ssh_hint__", args: [`vultr-cli instance get ${params.name}  # then: ssh root@<main_ip>`] }
        }
        case "snapshot": {
          const args = ["snapshot", "create", "--instance-id", params.name, "--description", `${params.name}-snapshot-${Date.now()}`, ...optionArgs]
          return { cli, args }
        }
      }
      break
    }
  }

  // TypeScript exhaustiveness guard — should never reach here
  throw new Error(`Unhandled provider/action combination: ${provider}/${action}`)
}

export const VpsTool = Tool.define("vps", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      action: z.enum(VPS_ACTIONS).describe("The VPS operation to perform"),
      provider: z.enum(VPS_PROVIDERS).describe("Cloud provider to use"),
      name: z.string().describe("Server/droplet/instance name or ID"),
      region: z.string().optional().describe("Provider-specific region (e.g., 'nyc3', 'us-east-1')"),
      size: z.string().optional().describe("Server size/type (e.g., 's-1vcpu-1gb', 't3.micro')"),
      image: z.string().optional().describe("OS image (e.g., 'ubuntu-22-04-x64')"),
      sshKey: z.string().optional().describe("SSH key name/fingerprint to add"),
      options: z.string().optional().describe("Additional CLI flags"),
    }),
    async execute(params, ctx) {
      const startTime = Date.now()

      log.info("vps execute", { action: params.action, provider: params.provider, name: params.name })

      // kilocode_change — for ssh action, just return the command string without spawning anything
      if (params.action === "ssh") {
        const { args } = buildVpsArgs(params.action, params.provider, params)
        const sshCommand = args[0] ?? ""
        return {
          title: `VPS: ssh hint for ${params.name} (${params.provider})`,
          metadata: {
            output: sshCommand,
            action: params.action as string,
            provider: params.provider as string,
            name: params.name,
            exitCode: null as number | null,
            durationMs: 0,
          },
          output: `SSH command:\n${sshCommand}`,
        }
      }

      // Ask for permission before any mutating/listing operation
      await ctx.ask({
        permission: "vps",
        patterns: [`vps ${params.action} ${params.provider}/${params.name}`],
        always: [`vps ${params.action} ${params.provider}/*`],
        metadata: {
          action: params.action,
          provider: params.provider,
          name: params.name,
        },
      })

      const { cli, args } = buildVpsArgs(params.action, params.provider, params)

      log.info("vps spawn", { cli, args })

      const proc = spawn(cli, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        windowsHide: true,
      })

      let output = ""

      ctx.metadata({
        metadata: {
          output: "",
          action: params.action,
          provider: params.provider,
          name: params.name,
        },
      })

      // kilocode_change — StringDecoder handles multi-byte UTF-8 characters split across chunks
      const stdoutDecoder = new StringDecoder("utf8")
      const stderrDecoder = new StringDecoder("utf8")
      const append = (decoder: StringDecoder) => (chunk: Buffer) => {
        output += decoder.write(chunk)
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            action: params.action,
            provider: params.provider,
            name: params.name,
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
        resultMetadata.push(`VPS command timed out after ${timeout}ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the VPS command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<vps_metadata>\n" + resultMetadata.join("\n") + "\n</vps_metadata>"
      }

      return {
        title: `VPS: ${params.action} ${params.provider}/${params.name}`,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          action: params.action as string,
          provider: params.provider as string,
          name: params.name,
          exitCode: proc.exitCode,
          durationMs,
        },
        output,
      }
    },
  }
})
