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
  line: number | null
}

export type InputStatus = "absent" | "invalid" | "ready"

export type ImportSources = {
  map: InputStatus
  log: InputStatus
  actionSet: boolean
  sample: boolean
  mapLabel: string
  logLabel: string
}

export type Workspace = {
  modelId: string
  actionSet: string[]
  mapping: MappingRow[]
  log: LogEntry[]
  sources: ImportSources
}

export type Severity = "high" | "medium" | "low" | "clear" | "unavailable"

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

export type TokenCount = {
  token: string
  events: number
  share: number
  mapped: boolean | null
  target: string | null
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
  counts: TokenCount[]
  demo: PassThroughDemo | null
  riskLabel: string
  riskDetail: string
}

export type ParseIssue = {
  source: "action-map" | "log"
  line: number | null
  message: string
  raw: string
}
