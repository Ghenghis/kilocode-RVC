// kilocode_change - Agent Capability Cards for dynamic tool discovery and routing
import z from "zod"

export namespace AgentCard {
  export const Skill = z
    .object({
      id: z.string(),
      description: z.string(),
      inputPatterns: z.array(z.string()),
      examples: z.array(z.string()),
    })
    .meta({ ref: "AgentCardSkill" })

  export type Skill = z.infer<typeof Skill>

  export const CostProfile = z
    .object({
      avgTokensPerTask: z.number(),
      avgLatencyMs: z.number(),
      modelTier: z.enum(["fast", "standard", "premium"]),
    })
    .meta({ ref: "AgentCardCostProfile" })

  export type CostProfile = z.infer<typeof CostProfile>

  export const PerformanceRecord = z
    .object({
      taskType: z.string(),
      successRate: z.number().min(0).max(1),
      avgDuration: z.number(),
      sampleCount: z.number(),
    })
    .meta({ ref: "AgentCardPerformanceRecord" })

  export type PerformanceRecord = z.infer<typeof PerformanceRecord>

  export const Info = z
    .object({
      name: z.string(),
      skills: z.array(Skill),
      costProfile: CostProfile,
      performanceHistory: z.array(PerformanceRecord),
    })
    .meta({ ref: "AgentCard" })

  export type Info = z.infer<typeof Info>

  /** Default capability cards for all built-in agents. */
  export function defaultCards(): Record<string, Info> {
    return {
      code: {
        name: "code",
        skills: [
          {
            id: "write-code",
            description: "Write new code, implement features, and create files",
            inputPatterns: [
              "\\b(write|create|implement|add|build|generate|make)\\b.*\\b(code|function|class|module|component|file|feature)\\b",
              "\\b(code|implement|scaffold|stub out|wire up)\\b",
            ],
            examples: [
              "Write a function that parses CSV files",
              "Create a new React component for the dashboard",
              "Implement the login feature",
              "Add a utility module for date formatting",
            ],
          },
          {
            id: "refactor",
            description: "Refactor, restructure, and improve existing code",
            inputPatterns: [
              "\\b(refactor|restructure|reorganize|clean\\s*up|simplify|extract|inline|rename|move)\\b",
              "\\b(improve|optimize)\\b.*\\b(code|function|class|module|performance)\\b",
            ],
            examples: [
              "Refactor this function to use async/await",
              "Clean up the duplicated logic in these two files",
              "Extract the validation into its own module",
              "Rename the handler functions to follow conventions",
            ],
          },
          {
            id: "add-tests",
            description: "Write unit tests, integration tests, and test fixtures",
            inputPatterns: [
              "\\b(add|write|create|generate)\\b.*\\b(test|tests|spec|specs|coverage)\\b",
              "\\btest\\b.*\\b(for|the|this|my)\\b",
            ],
            examples: [
              "Add unit tests for the parser module",
              "Write integration tests for the API endpoints",
              "Create test fixtures for the database layer",
              "Generate test coverage for the auth service",
            ],
          },
          {
            id: "edit-code",
            description: "Modify, update, or change existing code",
            inputPatterns: [
              "\\b(edit|modify|update|change|fix|patch|adjust|tweak|alter)\\b.*\\b(code|file|function|class|line|method)\\b",
              "\\b(replace|swap|switch)\\b.*\\b(with|to|for)\\b",
            ],
            examples: [
              "Update the config to use the new API endpoint",
              "Change the return type to Promise<void>",
              "Modify the middleware to handle CORS",
              "Fix the import path in the test file",
            ],
          },
        ],
        costProfile: {
          avgTokensPerTask: 4000,
          avgLatencyMs: 15000,
          modelTier: "standard",
        },
        performanceHistory: [],
      },

      debug: {
        name: "debug",
        skills: [
          {
            id: "fix-bug",
            description: "Find and fix bugs, errors, and unexpected behavior",
            inputPatterns: [
              "\\b(fix|resolve|patch|repair|correct)\\b.*\\b(bug|issue|error|problem|crash|failure)\\b",
              "\\b(bug|broken|failing|wrong|incorrect)\\b",
            ],
            examples: [
              "Fix the null pointer exception in the user service",
              "Resolve the failing test in auth.spec.ts",
              "Patch the race condition in the queue handler",
              "This function returns the wrong value",
            ],
          },
          {
            id: "debug-error",
            description: "Debug runtime errors, exceptions, and stack traces",
            inputPatterns: [
              "\\b(debug|diagnose|troubleshoot|investigate|trace)\\b",
              "\\b(error|exception|stack\\s*trace|traceback|panic|segfault|SIGSEGV)\\b",
              "\\b(TypeError|ReferenceError|SyntaxError|RangeError|RuntimeError|ValueError|KeyError|AttributeError)\\b",
            ],
            examples: [
              "Debug the TypeError in the payment module",
              "Investigate why the server crashes on startup",
              "Trace the source of the memory leak",
              "Diagnose the intermittent connection timeout",
            ],
          },
          {
            id: "diagnose-issue",
            description: "Diagnose performance issues, hangs, and unexpected behavior",
            inputPatterns: [
              "\\b(slow|hang|freeze|unresponsive|timeout|deadlock|memory\\s*leak|bottleneck)\\b",
              "\\b(why\\s+(does|is|did|do))\\b.*\\b(fail|crash|break|hang|slow|wrong)\\b",
            ],
            examples: [
              "Why does the app hang when processing large files",
              "Diagnose why the database queries are slow",
              "The build freezes at the TypeScript compilation step",
              "Memory usage keeps growing over time",
            ],
          },
        ],
        costProfile: {
          avgTokensPerTask: 5000,
          avgLatencyMs: 20000,
          modelTier: "standard",
        },
        performanceHistory: [],
      },

      explore: {
        name: "explore",
        skills: [
          {
            id: "find-file",
            description: "Find files, directories, and resources in the codebase",
            inputPatterns: [
              "\\b(find|locate|where\\s+is|where\\s+are|look\\s+for|search\\s+for)\\b.*\\b(file|files|directory|folder|module|component|config)\\b",
              "\\b(which\\s+file|what\\s+file)\\b",
            ],
            examples: [
              "Find the main configuration file",
              "Where is the database schema defined",
              "Locate all TypeScript files in the src directory",
              "Which file contains the user authentication logic",
            ],
          },
          {
            id: "search-code",
            description: "Search for code patterns, symbols, and references",
            inputPatterns: [
              "\\b(search|grep|find|look\\s+for)\\b.*\\b(code|usage|reference|definition|import|function|class|variable|symbol)\\b",
              "\\b(where\\s+is|where\\s+are)\\b.*\\b(used|defined|declared|imported|called|referenced|invoked)\\b",
            ],
            examples: [
              "Search for all usages of the DatabaseClient class",
              "Find where the API_KEY constant is defined",
              "Look for all imports of the auth module",
              "Where is the handleRequest function called",
            ],
          },
          {
            id: "codebase-structure",
            description: "Explore and understand codebase structure and architecture",
            inputPatterns: [
              "\\b(how\\s+does|how\\s+is|how\\s+are)\\b.*\\b(work|structured|organized|laid\\s+out|set\\s+up|arranged)\\b",
              "\\b(show\\s+me|list|overview|structure|architecture|layout)\\b.*\\b(codebase|project|repo|directory|folder)\\b",
            ],
            examples: [
              "How is the project structured",
              "Show me an overview of the src directory",
              "What is the architecture of the backend",
              "List all the modules in the packages directory",
            ],
          },
        ],
        costProfile: {
          avgTokensPerTask: 2000,
          avgLatencyMs: 8000,
          modelTier: "fast",
        },
        performanceHistory: [],
      },

      ask: {
        name: "ask",
        skills: [
          {
            id: "explain-code",
            description: "Explain code, functions, and algorithms",
            inputPatterns: [
              "\\b(explain|describe|walk\\s+me\\s+through|break\\s+down|clarify)\\b.*\\b(code|function|class|algorithm|logic|implementation)\\b",
              "\\b(what\\s+does|what\\s+is|what\\s+are)\\b.*\\b(do|mean|for|this|that|the)\\b",
            ],
            examples: [
              "Explain how the authentication middleware works",
              "What does this regex pattern do",
              "Walk me through the build pipeline",
              "Describe the data flow in the payment module",
            ],
          },
          {
            id: "answer-question",
            description: "Answer questions about the codebase, tools, and concepts",
            inputPatterns: [
              "\\b(how\\s+does|how\\s+do|how\\s+can|how\\s+to|how\\s+should)\\b",
              "\\b(why\\s+does|why\\s+is|why\\s+do|why\\s+are|why\\s+did)\\b",
              "\\b(can\\s+you|could\\s+you|would\\s+you)\\b.*\\b(tell|explain|describe|clarify|help\\s+me\\s+understand)\\b",
            ],
            examples: [
              "How does the caching layer work",
              "Why is the config loaded asynchronously",
              "Can you explain the permission system",
              "How should I structure a new plugin",
            ],
          },
          {
            id: "compare-options",
            description: "Compare approaches, libraries, or design decisions",
            inputPatterns: [
              "\\b(compare|difference|vs|versus|between|trade-?off|pros\\s+and\\s+cons|which\\s+is\\s+better)\\b",
              "\\b(should\\s+I|recommend|suggest|prefer|choose)\\b.*\\b(use|pick|go\\s+with|between)\\b",
            ],
            examples: [
              "Compare React hooks vs class components",
              "What is the difference between these two approaches",
              "Should I use a Map or an Object here",
              "What are the tradeoffs of lazy loading",
            ],
          },
        ],
        costProfile: {
          avgTokensPerTask: 2500,
          avgLatencyMs: 10000,
          modelTier: "fast",
        },
        performanceHistory: [],
      },

      plan: {
        name: "plan",
        skills: [
          {
            id: "create-plan",
            description: "Create implementation plans, roadmaps, and step-by-step guides",
            inputPatterns: [
              "\\b(plan|design|outline|draft|sketch|map\\s+out|lay\\s+out)\\b.*\\b(implementation|feature|migration|refactor|project|approach|strategy)\\b",
              "\\b(step-?by-?step|breakdown|decompose|phases?)\\b",
            ],
            examples: [
              "Plan the implementation of the new auth system",
              "Create a step-by-step migration guide for the database",
              "Outline the approach for refactoring the API layer",
              "Design a phased rollout plan for the new feature",
            ],
          },
          {
            id: "review-plan",
            description: "Review, update, and refine existing plans",
            inputPatterns: [
              "\\b(review|update|revise|refine|adjust|modify)\\b.*\\b(plan|roadmap|strategy|approach|timeline)\\b",
              "\\b(what\\s+should\\s+we\\s+do\\s+next|next\\s+steps|priorities)\\b",
            ],
            examples: [
              "Review the migration plan and suggest improvements",
              "Update the roadmap to account for the new requirements",
              "What should we prioritize next in the plan",
              "Refine the testing strategy for phase 2",
            ],
          },
        ],
        costProfile: {
          avgTokensPerTask: 3000,
          avgLatencyMs: 12000,
          modelTier: "standard",
        },
        performanceHistory: [],
      },
    }
  }
}
