import type { MappingRow } from "@/lib/types"

/**
 * Same rule as ActionMap.apply in general-intuition-sdk 0.24.0:
 * a listed token is replaced, any other token is returned unchanged,
 * and an empty map returns the list as it arrived.
 * This is a local reimplementation. It does not import or call the SDK.
 */
export function toMap(rows: MappingRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const source = row.source.trim()
    const target = row.target.trim()
    if (!source || !target) continue
    map.set(source, target)
  }
  return map
}

export function applyActionMap(keys: string[], rows: MappingRow[]): string[] {
  const map = toMap(rows)
  if (map.size === 0) return keys.slice()
  return keys.map((key) => {
    const target = map.get(key)
    return target === undefined ? key : target
  })
}
