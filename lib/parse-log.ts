import { parse } from "csv-parse/sync"
import { readJson, type JsonKeyHit } from "@/lib/json-doc"
import type { LogEntry, ParseIssue } from "@/lib/types"

const TOKEN_HEADERS = new Set(["token", "action", "key", "source", "name"])
const COUNT_HEADERS = new Set(["count", "n", "events", "times"])
const TIME_HEADERS = new Set(["t_ms", "t", "timestamp", "time_ms", "ts", "time"])

export type LogParse = {
  status: "absent" | "invalid" | "ready"
  entries: LogEntry[]
  issues: ParseIssue[]
}

type CsvRecord = {
  record: string[]
  raw: string
  info: { lines: number }
}

function issue(line: number | null, message: string, raw: string): ParseIssue {
  return { source: "log", line, message, raw: raw.replace(/\s+/g, " ").trim().slice(0, 180) }
}

function emptyLog(): LogParse {
  return { status: "absent", entries: [], issues: [] }
}

export function parseLog(text: string): LogParse {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (stripped.trim() === "") return emptyLog()
  const start = stripped.trimStart()
  if (start.startsWith("{") || start.startsWith("[")) return parseLogJson(stripped)
  return parseLogCsv(stripped)
}

function parseLogJson(text: string): LogParse {
  const doc = readJson(text)
  if (doc.error) {
    return {
      status: "invalid",
      entries: [],
      issues: [issue(doc.error.line, doc.error.message, text.trim().slice(0, 180))],
    }
  }
  return interpretLogJson(doc.value, doc.keys)
}

function interpretLogJson(value: unknown, keys: JsonKeyHit[]): LogParse {
  if (Array.isArray(value)) return recordsToLog(value, keys, "")
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    for (const name of ["events", "log", "session"]) {
      if (record[name] !== undefined) {
        if (!Array.isArray(record[name])) {
          return {
            status: "invalid",
            entries: [],
            issues: [issue(lineOf(keys, `/${name}`), `${name} must be an array of events.`, String(name))],
          }
        }
        return recordsToLog(record[name] as unknown[], keys, `/${name}`)
      }
    }
    const counts = record.counts !== undefined ? record.counts : record.tokens
    const countsPath = record.counts !== undefined ? "/counts" : "/tokens"
    if (counts !== undefined) {
      if (typeof counts !== "object" || counts === null || Array.isArray(counts)) {
        return {
          status: "invalid",
          entries: [],
          issues: [issue(lineOf(keys, countsPath), "counts must be an object of token to number.", countsPath)],
        }
      }
      return countsObject(counts as Record<string, unknown>, keys, countsPath)
    }
    if (looksLikeStringMap(record)) {
      return {
        status: "invalid",
        entries: [],
        issues: [
          issue(
            1,
            "This object maps tokens to strings, so it is an ActionMap, not a log. Paste it in the ActionMap field.",
            "token -> action",
          ),
        ],
      }
    }
    if (looksLikeCountMap(record)) return countsObject(record, keys, "")
  }
  return {
    status: "invalid",
    entries: [],
    issues: [
      issue(
        1,
        "A JSON log must be an array of tokens or events, or an object with events, log, session, or counts.",
        "",
      ),
    ],
  }
}

function looksLikeStringMap(record: Record<string, unknown>): boolean {
  const values = Object.values(record)
  return values.length > 0 && values.every((value) => typeof value === "string")
}

function looksLikeCountMap(record: Record<string, unknown>): boolean {
  const values = Object.values(record)
  return values.length > 0 && values.every((value) => typeof value === "number")
}

function countsObject(record: Record<string, unknown>, keys: JsonKeyHit[], prefix: string): LogParse {
  const issues: ParseIssue[] = []
  const entries: LogEntry[] = []
  for (const [key, value] of Object.entries(record)) {
    const line = lineOf(keys, `${prefix}/${key}`)
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      issues.push(issue(line, `Count for ${key || "(empty token)"} must be a positive integer.`, String(value)))
      continue
    }
    if (key.trim() === "") {
      issues.push(issue(line, "Count object has an empty token.", String(value)))
      continue
    }
    entries.push({
      id: `log-${entries.length + 1}-${key.trim()}`,
      tMs: 0,
      token: key.trim(),
      count: value,
      line,
    })
  }
  return { status: "ready", entries, issues }
}

function recordsToLog(records: unknown[], keys: JsonKeyHit[], prefix: string): LogParse {
  const issues: ParseIssue[] = []
  const entries: LogEntry[] = []
  records.forEach((record, index) => {
    const row = index + 1
    const path = `${prefix}/${index}`
    const line = lineOf(keys, `${path}/token`) ?? lineOf(keys, `${path}/action`) ?? lineOf(keys, path)
    if (typeof record === "string") {
      if (record.trim() === "") {
        issues.push(issue(line, `Row ${row}: token is empty.`, record))
        return
      }
      entries.push({ id: `log-${row}`, tMs: 0, token: record.trim(), count: 1, line })
      return
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      issues.push(issue(line, `Row ${row}: expected a token string or an event object.`, ""))
      return
    }
    const fields = record as Record<string, unknown>
    const token = firstField(fields, ["token", "action", "key", "source", "name"])
    if (typeof token !== "string" || token.trim() === "") {
      issues.push(issue(line, `Row ${row}: missing a token string.`, compact(fields)))
      return
    }
    const countField = firstField(fields, ["count", "n", "events", "times"])
    let count = 1
    if (countField !== undefined) {
      if (typeof countField !== "number" || !Number.isInteger(countField) || countField <= 0) {
        issues.push(issue(line, `Row ${row}: count must be a positive integer.`, compact(fields)))
        return
      }
      count = countField
    }
    const timeField = firstField(fields, ["t_ms", "t", "timestamp", "time_ms", "ts", "time"])
    let tMs = 0
    if (timeField !== undefined) {
      if (typeof timeField !== "number" || !Number.isFinite(timeField)) {
        issues.push(issue(line, `Row ${row}: timestamp is not a number of milliseconds. The event was still counted.`, compact(fields)))
      } else {
        tMs = timeField
      }
    }
    entries.push({ id: `log-${row}-${token.trim()}`, tMs, token: token.trim(), count, line })
  })
  return { status: "ready", entries, issues }
}

function firstField(record: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined) return record[name]
  }
  return undefined
}

function compact(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record)
  } catch {
    return ""
  }
}

function lineOf(keys: JsonKeyHit[], path: string): number | null {
  return keys.find((hit) => hit.path === path)?.line ?? null
}

function recordLine(endLine: number, raw: string): number {
  let body = raw
  while (body.startsWith("\r\n") || body.startsWith("\n") || body.startsWith("\r")) {
    if (body.startsWith("\r\n")) body = body.slice(2)
    else body = body.slice(1)
  }
  const breaks = body.match(/\r\n|\n|\r/g)?.length ?? 0
  const trailing = /\r\n$|\n$|\r$/.test(body) ? 1 : 0
  return endLine - Math.max(0, breaks - trailing)
}

function readCsv(text: string): { rows: CsvRecord[]; fatal: ParseIssue | null } {
  const options = {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    info: true,
    raw: true,
  } as const
  try {
    return { rows: parse(text, options) as CsvRecord[], fatal: null }
  } catch (error) {
    const csvError = error as { lines?: number; message?: string }
    const line = typeof csvError.lines === "number" ? csvError.lines : null
    const fatal = issue(
      line,
      `${csvError.message ?? "The CSV could not be parsed."} Rows after this line were not read.`,
      "",
    )
    if (line !== null && line > 1) {
      const prefix = text.split(/\r\n|\n|\r/).slice(0, line - 1).join("\n")
      try {
        return { rows: parse(prefix, options) as CsvRecord[], fatal }
      } catch {
        return { rows: [], fatal }
      }
    }
    return { rows: [], fatal }
  }
}

function parseLogCsv(text: string): LogParse {
  const { rows, fatal } = readCsv(text)
  const issues: ParseIssue[] = fatal ? [fatal] : []
  if (rows.length === 0) {
    return { status: fatal ? "invalid" : "ready", entries: [], issues }
  }

  const headerCells = rows[0].record.map((cell) => cell.trim().toLowerCase())
  const headerLine = recordLine(rows[0].info.lines, rows[0].raw)
  const usesHeader = TOKEN_HEADERS.has(headerCells[0] ?? "") || headerCells.some((cell) => TOKEN_HEADERS.has(cell))
  const dataRows = usesHeader ? rows.slice(1) : rows

  if (!usesHeader && (rows[0].record.length > 1 || headerCells.length > 1)) {
    return {
      status: "invalid",
      entries: [],
      issues: [
        issue(
          headerLine,
          "This CSV has no token header. Use a header such as token,count or a single column of tokens.",
          rows[0].raw,
        ),
        ...issues,
      ],
    }
  }

  let tokenIndex = 0
  let countIndex: number | null = null
  let timeIndex: number | null = null
  let width = 1
  if (usesHeader) {
    const tokenHits = headerCells
      .map((cell, index) => ({ cell, index }))
      .filter((item) => TOKEN_HEADERS.has(item.cell))
    if (tokenHits.length !== 1) {
      return {
        status: "invalid",
        entries: [],
        issues: [
          issue(headerLine, "The header must name exactly one token column (token, action, key, source, or name).", rows[0].raw),
          ...issues,
        ],
      }
    }
    tokenIndex = tokenHits[0].index
    const countHits = headerCells
      .map((cell, index) => ({ cell, index }))
      .filter((item) => COUNT_HEADERS.has(item.cell))
    const timeHits = headerCells
      .map((cell, index) => ({ cell, index }))
      .filter((item) => TIME_HEADERS.has(item.cell))
    if (countHits.length > 1) {
      issues.push(issue(headerLine, "The header names more than one count column. The first one is not assumed.", rows[0].raw))
      return { status: "invalid", entries: [], issues }
    }
    countIndex = countHits[0]?.index ?? null
    timeIndex = timeHits[0]?.index ?? null
    width = headerCells.length
  }

  const entries: LogEntry[] = []
  for (const row of dataRows) {
    const line = recordLine(row.info.lines, row.raw)
    const cells = row.record
    if (usesHeader && cells.length !== width) {
      issues.push(issue(line, `Expected ${width} columns and found ${cells.length}. This row was not counted.`, row.raw))
      continue
    }
    const token = (cells[tokenIndex] ?? "").trim()
    if (!token) {
      issues.push(issue(line, "Token is empty. This row was not counted.", row.raw))
      continue
    }
    let count = 1
    if (countIndex !== null) {
      const rawCount = (cells[countIndex] ?? "").trim()
      if (!/^[1-9]\d*$/.test(rawCount)) {
        issues.push(issue(line, `Count ${JSON.stringify(rawCount)} is not a positive integer. This row was not counted.`, row.raw))
        continue
      }
      count = Number(rawCount)
    }
    let tMs = 0
    if (timeIndex !== null) {
      const rawTime = (cells[timeIndex] ?? "").trim()
      if (rawTime !== "") {
        if (!/^-?\d+(\.\d+)?$/.test(rawTime)) {
          issues.push(issue(line, `Timestamp ${JSON.stringify(rawTime)} is not a number of milliseconds. The event was still counted.`, row.raw))
        } else {
          tMs = Number(rawTime)
        }
      }
    }
    entries.push({ id: `log-${line}-${token}-${entries.length + 1}`, tMs, token, count, line })
  }

  return { status: "ready", entries, issues }
}
