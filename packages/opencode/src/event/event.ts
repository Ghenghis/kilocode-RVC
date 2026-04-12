// kilocode_change — event-sourced agent state: core event types
import z from "zod"

export namespace AgentEvent {
  export const ActionPayload = z
    .object({
      tool: z.string(),
      input: z.record(z.string(), z.any()),
    })
    .meta({ ref: "AgentEvent.ActionPayload" })
  export type ActionPayload = z.infer<typeof ActionPayload>

  export const ObservationPayload = z
    .object({
      tool: z.string(),
      output: z.string(),
      success: z.boolean(),
      durationMs: z.number(),
    })
    .meta({ ref: "AgentEvent.ObservationPayload" })
  export type ObservationPayload = z.infer<typeof ObservationPayload>

  export const ReflectionPayload = z
    .object({
      summary: z.string(),
      learnings: z.array(z.string()),
      failedApproach: z.string().optional(),
    })
    .meta({ ref: "AgentEvent.ReflectionPayload" })
  export type ReflectionPayload = z.infer<typeof ReflectionPayload>

  export const StateChangePayload = z
    .object({
      from: z.string(),
      to: z.string(),
      reason: z.string(),
    })
    .meta({ ref: "AgentEvent.StateChangePayload" })
  export type StateChangePayload = z.infer<typeof StateChangePayload>

  export const EventType = z.enum(["action", "observation", "reflection", "state_change"])
  export type EventType = z.infer<typeof EventType>

  export const Payload = z.discriminatedUnion("type", [
    z.object({ type: z.literal("action"), data: ActionPayload }).meta({ ref: "AgentEvent.Payload.Action" }),
    z.object({ type: z.literal("observation"), data: ObservationPayload }).meta({ ref: "AgentEvent.Payload.Observation" }),
    z.object({ type: z.literal("reflection"), data: ReflectionPayload }).meta({ ref: "AgentEvent.Payload.Reflection" }),
    z.object({ type: z.literal("state_change"), data: StateChangePayload }).meta({ ref: "AgentEvent.Payload.StateChange" }),
  ])
  export type Payload = z.infer<typeof Payload>

  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      agentName: z.string(),
      timestamp: z.number(),
      type: EventType,
      payload: Payload,
      parentEventID: z.string().optional(),
    })
    .meta({ ref: "AgentEvent" })
  export type Info = z.infer<typeof Info>

  export const Filter = z
    .object({
      type: EventType.optional(),
      agentName: z.string().optional(),
      afterTimestamp: z.number().optional(),
      beforeTimestamp: z.number().optional(),
      parentEventID: z.string().optional(),
    })
    .meta({ ref: "AgentEvent.Filter" })
  export type Filter = z.infer<typeof Filter>
}
