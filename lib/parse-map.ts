import { keyLine, readJson, type JsonKeyHit } from "@/lib/json-doc"
import type { MappingRow, ParseIssue } from "@/lib/types"

const RESERVED = new Set([
  "mapping",
  "action_map",
  "action_set",
  "actionSet",
  "model_id",
  "modelId",
  "sample",
])

export type MapParse = {
  status: "absent" | "invalid" | "ready"
  rows: MappingRow[]
  actionSet: string[]
  actionSetProvided: boolean
  modelId: string
  sample: boolean
  issues: ParseIssue[]
}

function issue(line: number | null, message: string, raw: string): ParseIssue {
  return { source: "action-map", line, message, raw }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rawOf(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function parseActionMap(text: string): MapParse {
  const empty: MapParse = {
    status: "absent",
    rows: [],
    actionSet: [],
    actionSetProvided: false,
    modelId: "",
    sample: false,
    issues: [],
  }
  if (text.trim() === "") return empty

  const doc = readJson(text)
  if (doc.error) {
    return {
      ...empty,
      status: "invalid",
      issues: [issue(doc.error.line, doc.error.message, text.trim().slice(0, 180))],
    }
  }

  if (Array.isArray(doc.value)) return parsePairList(doc.value, doc.keys)
  if (!isRecord(doc.value)) {
    return {
      ...empty,
      status: "invalid",
      issues: [issue(1, "An ActionMap file must be a JSON object or an array of pairs.", rawOf(doc.value))],
    }
  }

  return parseMapObject(doc.value, doc.keys)
}

function parsePairList(value: unknown[], keys: JsonKeyHit[]): MapParse {
  const issues: ParseIssue[] = []
  const rows: MappingRow[] = []
  const seen = new Map<string, number>()
  value.forEach((entry, index) => {
    const rowNumber = index + 1
    const line = keyLine(keys, `/${index}`) ?? lineFromPair(keys, index)
    if (Array.isArray(entry)) {
      if (entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
        issues.push(issue(line, `Row ${rowNumber}: expected a pair of strings [token, action].`, rawOf(entry)))
        return
      }
      pushRow(rows, seen, issues, entry[0], entry[1], line, rowNumber)
      return
    }
    if (!isRecord(entry)) {
      issues.push(issue(line, `Row ${rowNumber}: expected [token, action] or { token, action }.`, rawOf(entry)))
      return
    }
    const source = firstString(entry, ["token", "source", "key"])
    const target = firstString(entry, ["action", "target"])
    if (!source || !target) {
      issues.push(
        issue(line, `Row ${rowNumber}: need a token and an action string.`, rawOf(entry)),
      )
      return
    }
    pushRow(rows, seen, issues, source, target, line, rowNumber)
  })
  return {
    status: "ready",
    rows,
    actionSet: [],
    actionSetProvided: false,
    modelId: "",
    sample: false,
    issues,
  }
}

function lineFromPair(keys: JsonKeyHit[], index: number): number | null {
  const hit = keys.find((item) => item.path.startsWith(`/${index}/`))
  return hit?.line ?? null
}

function firstString(entry: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = entry[name]
    if (typeof value === "string" && value.trim() !== "") return value.trim()
  }
  return null
}

function pushRow(
  rows: MappingRow[],
  seen: Map<string, number>,
  issues: ParseIssue[],
  source: string,
  target: string,
  line: number | null,
  rowNumber: number,
): void {
  const token = source.trim()
  const action = target.trim()
  if (!token || !action) {
    issues.push(issue(line, `Row ${rowNumber}: token and action must both be non-empty.`, `${source} -> ${target}`))
    return
  }
  const previous = seen.get(token)
  if (previous !== undefined) {
    issues.push(
      issue(
        line,
        `Duplicate token ${token}. The last action is the one apply() keeps. Earlier row ${previous}.`,
        `${token} -> ${action}`,
      ),
    )
    const index = rows.findIndex((row) => row.source === token)
    if (index >= 0) rows.splice(index, 1)
  }
  seen.set(token, rowNumber)
  rows.push({ id: `map-${rows.length + 1}-${token}`, source: token, target: action })
}

function parseMapObject(value: Record<string, unknown>, keys: JsonKeyHit[]): MapParse {
  const issues: ParseIssue[] = []
  const mappingInvalid = value.mapping !== undefined && !isRecord(value.mapping)
  const actionMapInvalid = value.action_map !== undefined && !isRecord(value.action_map)
  if (mappingInvalid) {
    issues.push(issue(keyLine(keys, "/mapping"), "mapping must be an object of token to action.", rawOf(value.mapping)))
  }
  if (actionMapInvalid) {
    issues.push(
      issue(keyLine(keys, "/action_map"), "action_map must be an object of token to action.", rawOf(value.action_map)),
    )
  }
  if (mappingInvalid || actionMapInvalid) {
    return {
      status: "invalid",
      rows: [],
      actionSet: [],
      actionSetProvided: false,
      modelId: "",
      sample: false,
      issues,
    }
  }
  const wrapperKey = isRecord(value.mapping) ? "mapping" : isRecord(value.action_map) ? "action_map" : null
  if (isRecord(value.mapping) && isRecord(value.action_map)) {
    issues.push(
      issue(keyLine(keys, "/action_map"), "action_map was ignored because mapping is also set.", rawOf(value.action_map)),
    )
  }

  const sample = readSampleFlag(value, keys, issues)
  const modelId = readModelId(value, keys, issues)
  const action = readActionSet(value, keys, issues)

  const entries = wrapperKey ? (value[wrapperKey] as Record<string, unknown>) : value
  const entryPrefix = wrapperKey ? `/${wrapperKey}` : ""
  if (wrapperKey) {
    for (const key of Object.keys(value)) {
      if (RESERVED.has(key)) continue
      issues.push(
        issue(
          keyLine(keys, `/${key}`),
          `Field ${key} was not read as a mapping row. Put token rows inside ${wrapperKey}.`,
          rawOf(value[key]),
        ),
      )
    }
  }

  const rows: MappingRow[] = []
  const seen = new Map<string, number>()
  const grouped = new Map<string, JsonKeyHit[]>()
  for (const hit of keys) {
    if (!hit.path.startsWith(`${entryPrefix}/`)) continue
    const rest = hit.path.slice(entryPrefix.length + 1)
    if (rest.includes("/")) continue
    const list = grouped.get(rest) ?? []
    list.push(hit)
    grouped.set(rest, list)
  }

  for (const [key, hits] of grouped) {
    if (!wrapperKey && RESERVED.has(key)) continue
    const line = hits[0]?.line ?? null
    const target = entries[key]
    if (hits.length > 1) {
      const last = hits[hits.length - 1]
      issues.push(
        issue(
          last?.line ?? line,
          `Duplicate token ${key}. The last action is the one apply() keeps.`,
          rawOf(target),
        ),
      )
    }
    if (typeof target !== "string") {
      issues.push(issue(line, `Token ${key} must map to an action string.`, rawOf(target)))
      continue
    }
    if (key.trim() === "" || target.trim() === "") {
      issues.push(issue(line, "Token and action must both be non-empty.", `${key} -> ${target}`))
      continue
    }
    const token = key.trim()
    const previous = seen.get(token)
    if (previous !== undefined) {
      issues.push(issue(line, `Duplicate token ${token} after trimming. The last action is kept.`, target))
      const index = rows.findIndex((row) => row.source === token)
      if (index >= 0) rows.splice(index, 1)
    }
    seen.set(token, rows.length + 1)
    rows.push({ id: `map-${rows.length + 1}-${token}`, source: token, target: target.trim() })
  }

  return {
    status: "ready",
    rows,
    actionSet: action.values,
    actionSetProvided: action.provided,
    modelId,
    sample,
    issues,
  }
}

function readSampleFlag(value: Record<string, unknown>, keys: JsonKeyHit[], issues: ParseIssue[]): boolean {
  if (value.sample === undefined) return false
  if (typeof value.sample !== "boolean") {
    issues.push(issue(keyLine(keys, "/sample"), "sample must be true or false.", rawOf(value.sample)))
    return false
  }
  return value.sample
}

function readModelId(value: Record<string, unknown>, keys: JsonKeyHit[], issues: ParseIssue[]): string {
  const raw = value.model_id !== undefined ? value.model_id : value.modelId
  if (raw === undefined) return ""
  const path = value.model_id !== undefined ? "/model_id" : "/modelId"
  if (typeof raw !== "string" || raw.trim() === "") {
    issues.push(issue(keyLine(keys, path), "model_id must be a non-empty string.", rawOf(raw)))
    return ""
  }
  return raw.trim()
}

function readActionSet(
  value: Record<string, unknown>,
  keys: JsonKeyHit[],
  issues: ParseIssue[],
): { provided: boolean; values: string[] } {
  const raw = value.action_set !== undefined ? value.action_set : value.actionSet
  if (raw === undefined) return { provided: false, values: [] }
  const path = value.action_set !== undefined ? "/action_set" : "/actionSet"
  const line = keyLine(keys, path)
  if (!Array.isArray(raw)) {
    issues.push(issue(line, "action_set must be an array of token strings.", rawOf(raw)))
    return { provided: false, values: [] }
  }
  const values: string[] = []
  raw.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      issues.push(issue(line, `action_set[${index}] must be a non-empty string.`, rawOf(entry)))
      return
    }
    const token = entry.trim()
    if (!values.includes(token)) values.push(token)
  })
  return { provided: true, values }
}
