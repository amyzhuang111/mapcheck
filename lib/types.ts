export type MappingRow = {
  id: string
  source: string
  target: string
}

export type LogEntry = {
  id: string
  tMs: number
  token: string
  count: number
}

export type Workspace = {
  modelId: string
  actionSet: string[]
  mapping: MappingRow[]
  log: LogEntry[]
}

export type Severity = "high" | "medium" | "low" | "clear"

export type UnmappedToken = {
  token: string
  inActionSet: boolean
  inLog: boolean
  events: number
  share: number
}

export type CollisionGroup = {
  target: string
  sources: string[]
  sourcesInLog: string[]
}

export type OrphanRow = {
  source: string
  target: string
}

export type RareToken = {
  token: string
  events: number
  share: number
  mapped: boolean
  target: string | null
  sharedTarget: boolean
}

export type FindingId = "unmapped" | "collisions" | "orphans" | "rare"

export type Finding = {
  id: FindingId
  title: string
  severity: Severity
  count: number
  tokens: string[]
  why: string
}

export type PassThroughDemo = {
  token: string
  input: string[]
  output: string[]
  identical: boolean
  contrastToken: string | null
  contrastInput: string[]
  contrastOutput: string[]
  contrastIdentical: boolean
}

export type AuditResult = {
  ranAt: string
  thresholdPct: number
  totalEvents: number
  findings: Finding[]
  unmapped: UnmappedToken[]
  collisions: CollisionGroup[]
  orphans: OrphanRow[]
  rare: RareToken[]
  demo: PassThroughDemo
  riskLabel: string
  riskDetail: string
}
