import { parseActionMap } from "@/lib/parse-map"
import { parseLog } from "@/lib/parse-log"
import type { ImportSources, ParseIssue, Workspace } from "@/lib/types"

export function textProvided(text: string): boolean {
  return text.trim() !== ""
}

export function loadImport(input: {
  mapText: string
  logText: string
  mapLabel: string
  logLabel: string
  sampleRequested: boolean
}): { workspace: Workspace; issues: ParseIssue[] } {
  const map = parseActionMap(input.mapText)
  const log = parseLog(input.logText)
  const sources: ImportSources = {
    map: map.status,
    log: log.status,
    actionSet: map.actionSetProvided,
    sample: input.sampleRequested || map.sample,
    mapLabel: input.mapLabel,
    logLabel: input.logLabel,
  }
  return {
    issues: [...map.issues, ...log.issues],
    workspace: {
      modelId: map.modelId,
      actionSet: map.actionSet,
      mapping: map.rows,
      log: log.entries,
      sources,
    },
  }
}
