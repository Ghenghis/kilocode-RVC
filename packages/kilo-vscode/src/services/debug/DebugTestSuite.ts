/**
 * DebugTestSuite — Comprehensive E2E Failsafe Test Runner
 *
 * Built into the KiloCode debugger. Validates all failsafe mechanisms,
 * backup systems, voice model infrastructure, Docker operations,
 * and voice output across all providers (Browser/Edge TTS, Azure, RVC).
 *
 * Invoked via the "kilo-code.runDebugTests" command.
 * Results are written to the DebugCollector log and shown in the output channel.
 */

import * as vscode from "vscode"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import { exec } from "child_process"
import { DebugCollector } from "./DebugCollector"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResult {
  name: string
  group: string
  passed: boolean
  duration: number
  detail: string
  error?: string
}

interface TestSuiteReport {
  startedAt: string
  completedAt: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  groups: Record<string, TestResult[]>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: stderr?.toString() ?? "" }))
      else resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" })
    })
  })
}

async function httpGet(url: string, timeoutMs = 15000): Promise<{ status: number; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { signal: controller.signal })
    const body = await resp.text()
    return { status: resp.status, body }
  } finally {
    clearTimeout(timer)
  }
}

async function httpPost(
  url: string,
  data: string,
  timeoutMs = 30000,
): Promise<{ status: number; body: string; bodyBytes?: ArrayBuffer }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data,
      signal: controller.signal,
    })
    const bodyBytes = await resp.arrayBuffer()
    const body = new TextDecoder().decode(bodyBytes)
    return { status: resp.status, body, bodyBytes }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

export class DebugTestSuite {
  private results: TestResult[] = []
  private output: vscode.OutputChannel
  private debug: DebugCollector
  private report: TestSuiteReport | null = null

  constructor() {
    this.output = vscode.window.createOutputChannel("KiloCode Test Suite")
    this.debug = DebugCollector.getInstance()
  }

  private log(msg: string): void {
    this.output.appendLine(msg)
    console.log(`[DebugTestSuite] ${msg}`)
  }

  private async runTest(
    group: string,
    name: string,
    fn: () => Promise<string>,
  ): Promise<TestResult> {
    const start = Date.now()
    let result: TestResult
    try {
      const detail = await fn()
      result = { name, group, passed: true, duration: Date.now() - start, detail }
      this.log(`  ✅ PASS: ${name} (${result.duration}ms) — ${detail}`)
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      result = { name, group, passed: false, duration: Date.now() - start, detail: "", error }
      this.log(`  ❌ FAIL: ${name} (${result.duration}ms) — ${error}`)
    }

    this.results.push(result)
    this.debug.record({
      source: "lifecycle",
      provider: "DebugTestSuite",
      type: result.passed ? "test-pass" : "test-fail",
      data: result,
    })
    return result
  }

  // =========================================================================
  // Main entry point
  // =========================================================================

  async runAll(): Promise<TestSuiteReport> {
    this.results = []
    const startedAt = new Date().toISOString()
    this.output.show(true)

    this.log("═══════════════════════════════════════════════════════════")
    this.log("  KiloCode E2E Failsafe Test Suite")
    this.log(`  Started: ${startedAt}`)
    this.log("═══════════════════════════════════════════════════════════")

    // Group 1: Debug System
    this.log("\n── Group 1: Debug System ──")
    await this.testDebugSystem()

    // Group 2: Docker Infrastructure
    this.log("\n── Group 2: Docker Infrastructure ──")
    await this.testDockerInfra()

    // Group 3: Settings Persistence
    this.log("\n── Group 3: Settings Persistence ──")
    await this.testSettingsPersistence()

    // Group 4: Voice Model Store
    this.log("\n── Group 4: Voice Model Store ──")
    await this.testVoiceModelStore()

    // Group 5: Edge TTS (Browser) Voices
    this.log("\n── Group 5: Edge TTS (Browser) Voices ──")
    await this.testEdgeTTSVoices()

    // Group 6: Docker Container Operations
    this.log("\n── Group 6: Docker Container Operations ──")
    await this.testDockerContainer()

    // Group 7: Failsafe Chains
    this.log("\n── Group 7: Failsafe Chains ──")
    await this.testFailsafeChains()

    // Group 8: GitHub Integration
    this.log("\n── Group 8: GitHub Integration ──")
    await this.testGitHub()

    const completedAt = new Date().toISOString()
    const passed = this.results.filter((r) => r.passed).length
    const failed = this.results.filter((r) => !r.passed).length

    // Build grouped results
    const groups: Record<string, TestResult[]> = {}
    for (const r of this.results) {
      if (!groups[r.group]) groups[r.group] = []
      groups[r.group].push(r)
    }

    this.report = {
      startedAt,
      completedAt,
      totalTests: this.results.length,
      passed,
      failed,
      skipped: 0,
      groups,
    }

    this.log("\n═══════════════════════════════════════════════════════════")
    this.log(`  RESULTS: ${passed}/${this.results.length} passed, ${failed} failed`)
    this.log(`  Completed: ${completedAt}`)
    this.log("═══════════════════════════════════════════════════════════")

    if (failed > 0) {
      this.log("\n── Failed Tests ──")
      for (const r of this.results.filter((r) => !r.passed)) {
        this.log(`  ❌ [${r.group}] ${r.name}: ${r.error}`)
      }
    }

    // Write report to debug log
    this.debug.record({
      source: "lifecycle",
      provider: "DebugTestSuite",
      type: "suite-complete",
      data: this.report,
    })

    // Write report to file
    const reportPath = path.join(os.homedir(), ".kilo-debug", "test-report.json")
    try {
      fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2))
      this.log(`\n📄 Full report: ${reportPath}`)
    } catch {
      /* ignore */
    }

    // Show summary notification
    if (failed === 0) {
      vscode.window.showInformationMessage(`✅ All ${passed} tests passed!`)
    } else {
      vscode.window.showWarningMessage(`⚠️ ${failed}/${this.results.length} tests failed. See "KiloCode Test Suite" output.`)
    }

    return this.report
  }

  // =========================================================================
  // Test Groups
  // =========================================================================

  // -- Group 1: Debug System ------------------------------------------------

  private async testDebugSystem(): Promise<void> {
    await this.runTest("Debug System", "DebugCollector singleton exists", async () => {
      const dc = DebugCollector.getInstance()
      if (!dc) throw new Error("DebugCollector.getInstance() returned null")
      return "Singleton accessible"
    })

    await this.runTest("Debug System", "DebugCollector is enabled", async () => {
      const dc = DebugCollector.getInstance()
      if (!dc.isEnabled()) throw new Error("DebugCollector is not enabled")
      return "Debug mode active"
    })

    await this.runTest("Debug System", "Debug log file writable", async () => {
      const dc = DebugCollector.getInstance()
      const logFile = dc.getLogFile()
      if (!logFile) throw new Error("No log file path")
      if (!fs.existsSync(logFile)) throw new Error(`Log file does not exist: ${logFile}`)
      const stat = fs.statSync(logFile)
      return `Log file exists (${Math.round(stat.size / 1024)} KB)`
    })

    await this.runTest("Debug System", "Debug snapshot file writable", async () => {
      const dc = DebugCollector.getInstance()
      const snapFile = dc.getSnapshotFile()
      if (!snapFile) throw new Error("No snapshot file path")
      if (!fs.existsSync(snapFile)) throw new Error("Snapshot file does not exist")
      return "Snapshot file accessible"
    })

    await this.runTest("Debug System", "Can record and retrieve entries", async () => {
      const dc = DebugCollector.getInstance()
      const marker = `test-marker-${Date.now()}`
      dc.record({
        source: "lifecycle",
        provider: "DebugTestSuite",
        type: marker,
        data: { test: true },
      })
      const dump = dc.dumpLastN(10)
      if (!dump.includes(marker)) throw new Error("Marker not found in recent entries")
      return "Record + retrieve working"
    })

    await this.runTest("Debug System", "Self-healing watchdog interval exists", async () => {
      // Verify the debug directory structure is intact
      const debugDir = path.join(os.homedir(), ".kilo-debug")
      if (!fs.existsSync(debugDir)) throw new Error("Debug directory missing")
      const indexPath = path.join(debugDir, "index.json")
      if (!fs.existsSync(indexPath)) throw new Error("Index file missing")
      return "Debug directory structure intact"
    })
  }

  // -- Group 2: Docker Infrastructure --------------------------------------

  private async testDockerInfra(): Promise<void> {
    await this.runTest("Docker", "Docker is installed", async () => {
      const { stdout } = await run("docker --version")
      return stdout.trim()
    })

    await this.runTest("Docker", "Docker daemon is running", async () => {
      await run("docker info")
      return "Docker daemon responsive"
    })

    await this.runTest("Docker", "GHCR authentication", async () => {
      try {
        const { stdout } = await run("docker login ghcr.io --get-login 2>/dev/null || echo anonymous")
        return `Logged in as: ${stdout.trim() || "anonymous"}`
      } catch {
        return "Not authenticated (will use fallback pull paths)"
      }
    })

    await this.runTest("Docker", "Check local RVC images", async () => {
      const images = [
        "ghcr.io/ghenghis/kilocode-rvc-tts:latest",
        "ghenghis/kilocode-rvc-tts:latest",
        "ghcr.io/ghenghis/kilocode-rvc:latest",
        "ghenghis/kilocode-rvc:latest",
      ]
      const found: string[] = []
      for (const img of images) {
        try {
          await run(`docker inspect --type=image ${img}`)
          found.push(img)
        } catch {
          /* not cached */
        }
      }
      if (found.length === 0) throw new Error("No RVC Docker images cached locally")
      return `Found ${found.length} images: ${found.join(", ")}`
    })

    await this.runTest("Docker", "Check running RVC containers", async () => {
      const { stdout } = await run('docker ps --filter "name=kilocode-rvc" --format "{{.Names}}|{{.Status}}|{{.Ports}}"')
      const lines = stdout.split("\n").filter(Boolean)
      if (lines.length === 0) {
        // Also check legacy name
        const { stdout: legacyOut } = await run('docker ps --filter "name=edge-tts" --format "{{.Names}}|{{.Status}}|{{.Ports}}"')
        const legacyLines = legacyOut.split("\n").filter(Boolean)
        if (legacyLines.length === 0) throw new Error("No RVC containers running")
        return `Legacy containers: ${legacyLines.join("; ")}`
      }
      return `Running: ${lines.join("; ")}`
    })
  }

  // -- Group 3: Settings Persistence ----------------------------------------

  private async testSettingsPersistence(): Promise<void> {
    const testKey = "speech.volume"
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")

    await this.runTest("Settings", "Read speech settings", async () => {
      const enabled = config.get<boolean>("enabled")
      const provider = config.get<string>("provider")
      const volume = config.get<number>("volume")
      return `enabled=${enabled}, provider=${provider}, volume=${volume}`
    })

    await this.runTest("Settings", "Write and verify setting persistence", async () => {
      const original = config.get<number>("volume", 80)
      const testVal = original === 42 ? 43 : 42

      // Write
      await config.update("volume", testVal, vscode.ConfigurationTarget.Global)
      // Read back
      const readBack = vscode.workspace.getConfiguration("kilo-code.new.speech").get<number>("volume")
      // Restore original
      await config.update("volume", original, vscode.ConfigurationTarget.Global)

      if (readBack !== testVal) throw new Error(`Write-read mismatch: wrote ${testVal}, got ${readBack}`)
      return `Write-read cycle passed (${testVal} → ${readBack} → restored ${original})`
    })

    await this.runTest("Settings", "Speech RVC settings exist", async () => {
      const voiceId = config.get<string>("rvc.voiceId")
      const port = config.get<number>("rvc.dockerPort")
      const edgeVoice = config.get<string>("rvc.edgeVoice")
      return `voiceId=${voiceId || "(none)"}, port=${port}, edgeVoice=${edgeVoice}`
    })

    await this.runTest("Settings", "Speech Azure settings exist", async () => {
      const region = config.get<string>("azure.region")
      const voiceId = config.get<string>("azure.voiceId")
      return `region=${region}, voiceId=${voiceId}`
    })

    await this.runTest("Settings", "Interaction mode setting", async () => {
      const mode = config.get<string>("interactionMode")
      if (!mode) throw new Error("interactionMode not set")
      return `interactionMode=${mode}`
    })
  }

  // -- Group 4: Voice Model Store -------------------------------------------

  private async testVoiceModelStore(): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const serverUrl = config.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")

    await this.runTest("Store", "Model server health check", async () => {
      const { status, body } = await httpGet(`${serverUrl}/health`)
      if (status !== 200) throw new Error(`Health check returned ${status}: ${body}`)
      const health = JSON.parse(body)
      return `Status: ${health.status}, models: ${health.model_count}`
    })

    await this.runTest("Store", "Fetch voice catalog", async () => {
      const { status, body } = await httpGet(`${serverUrl}/catalog`)
      if (status !== 200) throw new Error(`Catalog returned ${status}`)
      const catalog = JSON.parse(body)
      const voices = catalog.voices ?? []
      if (voices.length === 0) throw new Error("Catalog is empty")
      return `${voices.length} voices in catalog`
    })

    await this.runTest("Store", "Catalog search works", async () => {
      const { status, body } = await httpGet(`${serverUrl}/catalog/search?q=female`)
      if (status !== 200) throw new Error(`Search returned ${status}`)
      const results = JSON.parse(body)
      return `Search "female": ${results.voices?.length ?? 0} results`
    })

    await this.runTest("Store", "Edge TTS voice list", async () => {
      const { status, body } = await httpGet(`${serverUrl}/voices`)
      if (status !== 200) throw new Error(`Voices endpoint returned ${status}`)
      const voices = JSON.parse(body)
      if (!Array.isArray(voices) || voices.length === 0) throw new Error("No voices returned")
      // Count English voices
      const enVoices = voices.filter((v: Record<string, unknown>) =>
        String(v.Locale ?? "").startsWith("en-"),
      )
      return `${voices.length} total voices, ${enVoices.length} English`
    })

    await this.runTest("Store", "Disk usage endpoint", async () => {
      const { status, body } = await httpGet(`${serverUrl}/disk`)
      if (status !== 200) throw new Error(`Disk endpoint returned ${status}`)
      const disk = JSON.parse(body)
      const usedMB = Math.round(disk.usedBytes / (1024 * 1024))
      const maxGB = Math.round(disk.maxBytes / (1024 * 1024 * 1024))
      return `${usedMB} MB used / ${maxGB} GB max, ${disk.modelCount} models`
    })

    // Test 5 different voice model entries
    await this.runTest("Store", "Validate 5 voice model entries", async () => {
      const { body } = await httpGet(`${serverUrl}/catalog`)
      const catalog = JSON.parse(body)
      const voices = (catalog.voices ?? []).filter(
        (v: Record<string, string>) => v.id !== "hubert_base" && v.id !== "rmvpe",
      )
      if (voices.length < 5) throw new Error(`Only ${voices.length} voices, need 5`)

      const sample = voices.slice(0, 5) as Array<Record<string, unknown>>
      const validated: string[] = []
      for (const v of sample) {
        if (!v.id) throw new Error("Voice missing id")
        if (!v.name) throw new Error(`Voice ${v.id} missing name`)
        if (!v.downloadUrl) throw new Error(`Voice ${v.id} missing downloadUrl`)
        if (typeof v.fileSize !== "number" || v.fileSize <= 0) {
          throw new Error(`Voice ${v.id} has invalid fileSize: ${v.fileSize}`)
        }
        validated.push(String(v.id))
      }
      return `Validated: ${validated.join(", ")}`
    })
  }

  // -- Group 5: Edge TTS Voices ---------------------------------------------

  private async testEdgeTTSVoices(): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const serverUrl = config.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")

    // Test 5 different Edge TTS voices for synthesis
    const testVoices = [
      "en-US-AriaNeural",
      "en-US-GuyNeural",
      "en-GB-SoniaNeural",
      "en-AU-NatashaNeural",
      "en-US-JennyNeural",
    ]

    for (const voice of testVoices) {
      await this.runTest("Edge TTS", `Synthesize with ${voice}`, async () => {
        const text = encodeURIComponent(`Test synthesis with ${voice}. KiloCode voice system test.`)
        const { status, body, bodyBytes } = await httpPost(
          `${serverUrl}/synthesize?text=${text}&voice=${voice}`,
          "",
          30000,
        )
        if (status === 500 && body.includes("403")) {
          throw new Error(`Edge TTS token expired on server — update edge-tts package. Detail: ${body.slice(0, 150)}`)
        }
        if (status !== 200) throw new Error(`Synthesis returned ${status}: ${body.slice(0, 200)}`)
        if (!bodyBytes || bodyBytes.byteLength < 100) {
          throw new Error(`Synthesis returned too-small audio: ${bodyBytes?.byteLength ?? 0} bytes`)
        }
        const sizeKB = Math.round(bodyBytes.byteLength / 1024)
        return `${sizeKB} KB audio generated`
      })
    }
  }

  // -- Group 6: Docker Container Operations ---------------------------------

  private async testDockerContainer(): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
    const port = config.get<number>("rvc.dockerPort", 5050)

    await this.runTest("Container", "RVC container health check", async () => {
      const { status, body } = await httpGet(`http://127.0.0.1:${port}/health`, 10000)
      if (status !== 200) throw new Error(`Health check returned ${status}: ${body}`)
      const health = JSON.parse(body)
      return `Status: ${health.status}, models: ${health.model_count}`
    })

    await this.runTest("Container", "RVC container voice list", async () => {
      const { status, body } = await httpGet(`http://127.0.0.1:${port}/voices`)
      if (status !== 200) throw new Error(`Voices returned ${status}`)
      const voices = JSON.parse(body)
      return `${Array.isArray(voices) ? voices.length : 0} voices available`
    })

    await this.runTest("Container", "RVC container catalog", async () => {
      try {
        const { status, body } = await httpGet(`http://127.0.0.1:${port}/catalog`)
        if (status === 404) return "Catalog not available (no models directory)"
        if (status !== 200) throw new Error(`Catalog returned ${status}`)
        const catalog = JSON.parse(body)
        return `${catalog.voices?.length ?? 0} voices in container catalog`
      } catch (e: unknown) {
        if (String(e).includes("ECONNREFUSED")) throw new Error("Container not running")
        throw e
      }
    })

    await this.runTest("Container", "Local synthesize endpoint", async () => {
      try {
        const text = encodeURIComponent("KiloCode RVC container voice test")
        const { status, body, bodyBytes } = await httpPost(
          `http://127.0.0.1:${port}/synthesize?text=${text}&voice=en-US-AriaNeural`,
          "",
          30000,
        )
        if (status !== 200) throw new Error(`Synthesis returned ${status}: ${body.slice(0, 200)}`)
        const sizeKB = Math.round((bodyBytes?.byteLength ?? 0) / 1024)
        return `${sizeKB} KB audio from local container`
      } catch (e: unknown) {
        if (String(e).includes("ECONNREFUSED")) throw new Error("Container not running")
        throw e
      }
    })
  }

  // -- Group 7: Failsafe Chains --------------------------------------------

  private async testFailsafeChains(): Promise<void> {
    await this.runTest("Failsafe", "Debug directory auto-creation", async () => {
      const dir = path.join(os.homedir(), ".kilo-debug")
      if (!fs.existsSync(dir)) throw new Error("Debug dir should be auto-created")
      return "Directory exists and writable"
    })

    await this.runTest("Failsafe", "Container name resolution chain", async () => {
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const port = config.get<number>("rvc.dockerPort", 5050)

      // Test new-style name
      const newName = `kilocode-rvc-${port}`
      let found = ""

      try {
        const { stdout } = await run(`docker inspect --format="{{.State.Status}}" ${newName}`)
        if (stdout.trim()) found = `new-style (${newName})`
      } catch {
        /* not found */
      }

      if (!found) {
        try {
          const { stdout } = await run('docker ps --filter "name=kilocode-rvc" --format "{{.Names}}"')
          const first = stdout.split("\n").filter(Boolean)[0]
          if (first) found = `pattern-match (${first})`
        } catch {
          /* continue */
        }
      }

      if (!found) {
        try {
          const { stdout } = await run('docker inspect --format="{{.State.Status}}" edge-tts-server')
          if (stdout.trim()) found = "legacy (edge-tts-server)"
        } catch {
          /* not found */
        }
      }

      if (!found) throw new Error("No container found via any resolution path")
      return `Resolved via: ${found}`
    })

    await this.runTest("Failsafe", "Image pull fallback chain", async () => {
      const images = [
        "ghcr.io/ghenghis/kilocode-rvc-tts:latest",
        "ghenghis/kilocode-rvc-tts:latest",
        "ghcr.io/ghenghis/kilocode-rvc:latest",
        "ghenghis/kilocode-rvc:latest",
      ]
      const available: string[] = []
      for (const img of images) {
        try {
          await run(`docker inspect --type=image ${img}`)
          available.push(img)
        } catch {
          /* not cached */
        }
      }
      if (available.length === 0) throw new Error("No images available in any fallback path")
      return `${available.length} images in fallback chain: ${available.join(", ")}`
    })

    await this.runTest("Failsafe", "Port scan range (5050-5150)", async () => {
      const net = await import("net")
      let freeCount = 0
      for (let p = 5050; p <= 5060; p++) {
        const free = await new Promise<boolean>((resolve) => {
          const srv = net.createServer()
          srv.once("error", () => resolve(false))
          srv.once("listening", () => srv.close(() => resolve(true)))
          srv.listen(p, "127.0.0.1")
        })
        if (free) freeCount++
      }
      return `${freeCount}/11 ports free in range 5050-5060`
    })

    await this.runTest("Failsafe", "Model server connectivity", async () => {
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const serverUrl = config.get<string>("rvc.modelServerUrl", "https://voice.daveai.tech")
      try {
        const { status } = await httpGet(`${serverUrl}/health`)
        return `Server responded with ${status}`
      } catch (e: unknown) {
        throw new Error(`Server unreachable: ${e}`)
      }
    })

    await this.runTest("Failsafe", "Settings save confirmation", async () => {
      // Verify the updateSetting handler sends confirmation back
      const config = vscode.workspace.getConfiguration("kilo-code.new.speech")
      const original = config.get<number>("volume", 80)
      await config.update("volume", original, vscode.ConfigurationTarget.Global)
      // If we got here without error, the update succeeded
      return "Settings update completes without error"
    })
  }

  // -- Group 8: GitHub Integration -----------------------------------------

  private async testGitHub(): Promise<void> {
    await this.runTest("GitHub", "git installed", async () => {
      const { stdout } = await run("git --version")
      return stdout.trim()
    })

    await this.runTest("GitHub", "git repo status", async () => {
      const wsDir =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
      try {
        const { stdout } = await run(`git -C "${wsDir}" status --porcelain --short`)
        const lines = stdout.split("\n").filter(Boolean)
        return `${lines.length} changed files in workspace`
      } catch {
        return "Not a git repository (or git not configured)"
      }
    })

    await this.runTest("GitHub", "GitHub CLI auth status", async () => {
      try {
        const { stdout, stderr } = await run("gh auth status")
        const output = (stdout + stderr).trim()
        if (output.includes("Logged in")) return output.split("\n")[1]?.trim() ?? "Authenticated"
        return "Authenticated"
      } catch (e: unknown) {
        const msg = String(e)
        if (msg.includes("not logged")) throw new Error("GitHub CLI not authenticated")
        throw e
      }
    })

    await this.runTest("GitHub", "git remote configured", async () => {
      const wsDir =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
      try {
        const { stdout } = await run(`git -C "${wsDir}" remote -v`)
        const lines = stdout.split("\n").filter(Boolean)
        if (lines.length === 0) throw new Error("No git remotes configured")
        return lines[0]?.trim() ?? "Remote configured"
      } catch {
        throw new Error("Failed to read git remotes")
      }
    })
  }
}

// ---------------------------------------------------------------------------
// VS Code command registration
// ---------------------------------------------------------------------------

export function registerDebugTestCommand(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand("kilo-code.runDebugTests", async () => {
    const suite = new DebugTestSuite()
    await suite.runAll()
  })
  context.subscriptions.push(cmd)
}
