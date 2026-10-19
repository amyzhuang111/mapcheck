export type JsonKeyHit = {
  path: string
  key: string
  line: number
}

export type JsonDocument = {
  value: unknown
  keys: JsonKeyHit[]
  error: { line: number; message: string } | null
}

class JsonReadError extends Error {
  line: number

  constructor(line: number, message: string) {
    super(message)
    this.line = line
  }
}

class Reader {
  private index = 0
  private line = 1
  readonly keys: JsonKeyHit[] = []

  constructor(private readonly text: string) {}

  document(): unknown {
    this.skip()
    if (this.eof()) this.fail("The file is empty.")
    const value = this.parseValue("")
    this.skip()
    if (!this.eof()) this.fail("Unexpected extra text after the JSON value.")
    return value
  }

  private eof(): boolean {
    return this.index >= this.text.length
  }

  private peek(): string {
    return this.text[this.index] ?? ""
  }

  private fail(message: string): never {
    throw new JsonReadError(this.line, message)
  }

  private skip(): void {
    while (!this.eof()) {
      const ch = this.peek()
      if (ch === "\n") {
        this.line += 1
        this.index += 1
        continue
      }
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.index += 1
        continue
      }
      break
    }
  }

  private parseValue(path: string): unknown {
    this.skip()
    const ch = this.peek()
    if (ch === "{") return this.parseObject(path)
    if (ch === "[") return this.parseArray(path)
    if (ch === '"') return this.parseString()
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber()
    if (this.text.startsWith("true", this.index)) return this.parseLiteral("true", true)
    if (this.text.startsWith("false", this.index)) return this.parseLiteral("false", false)
    if (this.text.startsWith("null", this.index)) return this.parseLiteral("null", null)
    if (this.eof()) this.fail("Unexpected end of JSON.")
    this.fail(`Unexpected character ${JSON.stringify(ch)}.`)
  }

  private parseLiteral(word: string, value: unknown): unknown {
    this.index += word.length
    return value
  }

  private parseObject(path: string): Record<string, unknown> {
    this.index += 1
    const obj: Record<string, unknown> = Object.create(null)
    this.skip()
    if (this.peek() === "}") {
      this.index += 1
      return obj
    }
    while (true) {
      this.skip()
      if (this.peek() !== '"') this.fail("Expected a string key.")
      const keyLine = this.line
      const key = this.parseString()
      const keyPath = `${path}/${key}`
      this.keys.push({ path: keyPath, key, line: keyLine })
      this.skip()
      if (this.peek() !== ":") this.fail("Expected a colon after the key.")
      this.index += 1
      obj[key] = this.parseValue(keyPath)
      this.skip()
      if (this.peek() === ",") {
        this.index += 1
        this.skip()
        if (this.peek() === "}") this.fail("Trailing comma in an object.")
        continue
      }
      if (this.peek() === "}") {
        this.index += 1
        break
      }
      if (this.eof()) this.fail("Unexpected end of JSON inside an object.")
      this.fail("Expected a comma or a closing brace.")
    }
    return obj
  }

  private parseArray(path: string): unknown[] {
    this.index += 1
    const arr: unknown[] = []
    this.skip()
    if (this.peek() === "]") {
      this.index += 1
      return arr
    }
    while (true) {
      const value = this.parseValue(`${path}/${arr.length}`)
      arr.push(value)
      this.skip()
      if (this.peek() === ",") {
        this.index += 1
        this.skip()
        if (this.peek() === "]") this.fail("Trailing comma in an array.")
        continue
      }
      if (this.peek() === "]") {
        this.index += 1
        break
      }
      if (this.eof()) this.fail("Unexpected end of JSON inside an array.")
      this.fail("Expected a comma or a closing bracket.")
    }
    return arr
  }

  private parseString(): string {
    this.index += 1
    let out = ""
    while (!this.eof()) {
      const ch = this.peek()
      if (ch === '"') {
        this.index += 1
        return out
      }
      if (ch === "\n" || ch === "\r") this.fail("Unescaped line break inside a string.")
      if (ch === "\\") {
        const next = this.text[this.index + 1]
        if (next === undefined) this.fail("Unfinished escape in a string.")
        if (next === "u") {
          const hex = this.text.slice(this.index + 2, this.index + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("Invalid unicode escape.")
          out += String.fromCharCode(Number.parseInt(hex, 16))
          this.index += 6
          continue
        }
        const escaped: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        }
        if (!(next in escaped)) this.fail(`Invalid escape \\${next}.`)
        out += escaped[next]
        this.index += 2
        continue
      }
      out += ch
      this.index += 1
    }
    this.fail("Unclosed string.")
  }

  private parseNumber(): number {
    const start = this.index
    if (this.peek() === "-") this.index += 1
    if (this.peek() === "0") {
      this.index += 1
    } else if (this.peek() >= "1" && this.peek() <= "9") {
      while (this.peek() >= "0" && this.peek() <= "9") this.index += 1
    } else {
      this.fail("Invalid number.")
    }
    if (this.peek() === ".") {
      this.index += 1
      if (!(this.peek() >= "0" && this.peek() <= "9")) this.fail("Invalid number.")
      while (this.peek() >= "0" && this.peek() <= "9") this.index += 1
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.index += 1
      if (this.peek() === "+" || this.peek() === "-") this.index += 1
      if (!(this.peek() >= "0" && this.peek() <= "9")) this.fail("Invalid number.")
      while (this.peek() >= "0" && this.peek() <= "9") this.index += 1
    }
    return Number(this.text.slice(start, this.index))
  }
}

export function readJson(text: string): JsonDocument {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const reader = new Reader(stripped)
  try {
    return { value: reader.document(), keys: reader.keys, error: null }
  } catch (error) {
    if (error instanceof JsonReadError) {
      return { value: null, keys: [], error: { line: error.line, message: error.message } }
    }
    throw error
  }
}

export function keyLine(keys: JsonKeyHit[], path: string, occurrence = 0): number | null {
  const hits = keys.filter((hit) => hit.path === path)
  return hits[occurrence]?.line ?? null
}
