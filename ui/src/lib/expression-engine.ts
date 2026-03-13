/**
 * Expression Engine for Advanced Search (v2)
 *
 * Safely evaluates Headlamp-style expressions against Kubernetes resource objects.
 *
 * Supported syntax:
 *   status.phase !== "Running"
 *   metadata.labels["app"] === "nginx"
 *   metadata.annotations["deployment.kubernetes.io/revision"] > 10
 *   spec.replicas >= 2
 *   spec.suspend === false && status.succeeded > 0
 *   !!data
 *   metadata.name.includes("nginx")
 *   metadata.name.startsWith("web-")
 *   metadata.name.endsWith("-prod")
 *   metadata.name.matches("^web-.*-prod$")           // regex match
 *   metadata.labels.length > 3                        // object key count
 *   spec.containers.length >= 2                       // array length
 *   status.phase in ("Running", "Succeeded")          // set membership
 *   status.phase not in ("Failed", "Unknown")         // set exclusion
 *   exists(metadata.labels["app"])                     // existence check
 *   !exists(metadata.annotations["deprecated"])        // non-existence
 *   metadata.creationTimestamp.age > "24h"             // age comparison
 *   (status.phase === "Running" || status.phase === "Succeeded") && spec.replicas > 1
 */

// ---------------------------------------------------------------------------
// Path resolver – walks nested object keys, supporting both dot and bracket notation
// ---------------------------------------------------------------------------
export function resolvePath(obj: unknown, path: string): unknown {
    const tokens: string[] = []
    let i = 0
    const p = path.trim()
    while (i < p.length) {
        if (p[i] === '[') {
            const end = p.indexOf(']', i)
            if (end === -1) break
            let key = p.slice(i + 1, end)
            if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
                key = key.slice(1, -1)
            }
            tokens.push(key)
            i = end + 1
            if (p[i] === '.') i++
        } else if (p[i] === '.') {
            i++
        } else {
            const nextDot = p.indexOf('.', i)
            const nextBracket = p.indexOf('[', i)
            let end: number
            if (nextDot === -1 && nextBracket === -1) end = p.length
            else if (nextDot === -1) end = nextBracket
            else if (nextBracket === -1) end = nextDot
            else end = Math.min(nextDot, nextBracket)
            tokens.push(p.slice(i, end))
            i = end
        }
    }

    let curr: unknown = obj
    for (const token of tokens) {
        if (curr === null || curr === undefined) return undefined
        // Support .length on arrays and objects
        if (token === 'length') {
            if (Array.isArray(curr)) return curr.length
            if (typeof curr === 'string') return curr.length
            if (typeof curr === 'object' && curr !== null) return Object.keys(curr).length
            return undefined
        }
        curr = (curr as Record<string, unknown>)[token]
    }
    return curr
}

// ---------------------------------------------------------------------------
// Age parser – converts age strings like "24h", "7d", "30m" to milliseconds
// ---------------------------------------------------------------------------
function parseAge(ageStr: string): number | null {
    const match = ageStr.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i)
    if (!match) return null
    const num = parseFloat(match[1])
    const unit = match[2].toLowerCase()
    const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }
    return num * (multipliers[unit] || 0)
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------
type TokenType =
    | 'STRING'
    | 'NUMBER'
    | 'BOOLEAN'
    | 'NULL'
    | 'IDENTIFIER'
    | 'OP'
    | 'AND'
    | 'OR'
    | 'NOT'
    | 'LPAREN'
    | 'RPAREN'
    | 'COMMA'
    | 'IN'
    | 'NOT_IN'
    | 'EXISTS'
    | 'DOT'
    | 'EOF'

interface Token {
    type: TokenType
    value: string
}

// ---------------------------------------------------------------------------
// Lexer (v2 – supports in, not in, exists, regex, more methods)
// ---------------------------------------------------------------------------
function tokenize(expr: string): Token[] {
    const tokens: Token[] = []
    let i = 0

    while (i < expr.length) {
        if (/\s/.test(expr[i])) { i++; continue }

        // String literals
        if (expr[i] === '"' || expr[i] === "'") {
            const quote = expr[i]
            let str = ''
            i++
            while (i < expr.length && expr[i] !== quote) {
                if (expr[i] === '\\') { i++; str += expr[i] } else str += expr[i]
                i++
            }
            i++
            tokens.push({ type: 'STRING', value: str })
            continue
        }

        // Regex literal /pattern/flags
        if (expr[i] === '/' && tokens.length > 0 && (tokens[tokens.length - 1].type === 'OP' || tokens[tokens.length - 1].value === 'matches')) {
            i++
            let pattern = ''
            while (i < expr.length && expr[i] !== '/') {
                if (expr[i] === '\\') { pattern += expr[i]; i++ }
                pattern += expr[i]
                i++
            }
            i++ // skip closing /
            let flags = ''
            while (i < expr.length && /[gimsuy]/.test(expr[i])) { flags += expr[i]; i++ }
            tokens.push({ type: 'STRING', value: `__regex__:${flags}:${pattern}` })
            continue
        }

        // Comma (for "in" sets)
        if (expr[i] === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue }

        // Operators
        if (expr.slice(i, i + 3) === '===') { tokens.push({ type: 'OP', value: '===' }); i += 3; continue }
        if (expr.slice(i, i + 3) === '!==') { tokens.push({ type: 'OP', value: '!==' }); i += 3; continue }
        if (expr.slice(i, i + 2) === '=~') { tokens.push({ type: 'OP', value: '=~' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '!~') { tokens.push({ type: 'OP', value: '!~' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '==') { tokens.push({ type: 'OP', value: '==' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '!=') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '>=') { tokens.push({ type: 'OP', value: '>=' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '<=') { tokens.push({ type: 'OP', value: '<=' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '&&') { tokens.push({ type: 'AND', value: '&&' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '||') { tokens.push({ type: 'OR', value: '||' }); i += 2; continue }
        if (expr.slice(i, i + 2) === '!!') { tokens.push({ type: 'NOT', value: '!!' }); i += 2; continue }
        if (expr[i] === '!') { tokens.push({ type: 'NOT', value: '!' }); i++; continue }
        if (expr[i] === '>') { tokens.push({ type: 'OP', value: '>' }); i++; continue }
        if (expr[i] === '<') { tokens.push({ type: 'OP', value: '<' }); i++; continue }
        if (expr[i] === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue }
        if (expr[i] === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue }

        // Numbers
        if (/\d/.test(expr[i]) || (expr[i] === '-' && /\d/.test(expr[i + 1] || ''))) {
            let num = ''
            if (expr[i] === '-') { num += '-'; i++ }
            while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i]; i++ }
            tokens.push({ type: 'NUMBER', value: num })
            continue
        }

        // Identifiers / keywords
        if (/[a-zA-Z_$]/.test(expr[i])) {
            let id = ''
            while (i < expr.length) {
                if (/[a-zA-Z0-9_$]/.test(expr[i])) { id += expr[i]; i++; continue }
                if (expr[i] === '.') {
                    if (i + 1 < expr.length && /[a-zA-Z_$\[]/.test(expr[i + 1])) { id += expr[i]; i++; continue }
                    break
                }
                if (expr[i] === '[') {
                    let bracket = '['
                    i++
                    while (i < expr.length && expr[i] !== ']') { bracket += expr[i]; i++ }
                    bracket += ']'
                    i++
                    id += bracket
                    continue
                }
                break
            }

            // Method calls: .includes("x"), .startsWith("x"), .endsWith("x"), .matches("pattern")
            const methodMatch = expr.slice(i).match(/^\.(includes|startsWith|endsWith|matches)\(/)
            if (methodMatch) {
                const method = methodMatch[1]
                i += methodMatch[0].length
                let arg = ''
                const quote2 = expr[i]
                if (quote2 === '"' || quote2 === "'") {
                    i++
                    while (i < expr.length && expr[i] !== quote2) {
                        if (expr[i] === '\\') { i++; arg += expr[i] } else arg += expr[i]
                        i++
                    }
                    i++
                }
                if (expr[i] === ')') i++
                tokens.push({ type: 'IDENTIFIER', value: `${id}.${method}:${arg}` })
                continue
            }

            // .age pseudo-property for timestamps
            if (expr.slice(i, i + 4) === '.age') {
                id += '.age'
                i += 4
            }

            // Keywords
            if (id === 'true') { tokens.push({ type: 'BOOLEAN', value: 'true' }); continue }
            if (id === 'false') { tokens.push({ type: 'BOOLEAN', value: 'false' }); continue }
            if (id === 'null') { tokens.push({ type: 'NULL', value: 'null' }); continue }
            if (id === 'undefined') { tokens.push({ type: 'NULL', value: 'null' }); continue }

            // "not in" keyword pair
            if (id === 'not') {
                // Skip whitespace
                let j = i
                while (j < expr.length && /\s/.test(expr[j])) j++
                if (expr.slice(j, j + 2) === 'in' && (j + 2 >= expr.length || !/[a-zA-Z0-9_]/.test(expr[j + 2]))) {
                    i = j + 2
                    tokens.push({ type: 'NOT_IN', value: 'not in' })
                    continue
                }
            }

            // "in" keyword
            if (id === 'in') { tokens.push({ type: 'IN', value: 'in' }); continue }

            // "exists" keyword
            if (id === 'exists') { tokens.push({ type: 'EXISTS', value: 'exists' }); continue }

            tokens.push({ type: 'IDENTIFIER', value: id })
            continue
        }

        i++
    }

    tokens.push({ type: 'EOF', value: '' })
    return tokens
}

// ---------------------------------------------------------------------------
// Evaluator (v2)
// ---------------------------------------------------------------------------
function resolveValue(token: Token, obj: unknown): unknown {
    switch (token.type) {
        case 'STRING': return token.value
        case 'NUMBER': return Number(token.value)
        case 'BOOLEAN': return token.value === 'true'
        case 'NULL': return null
        case 'IDENTIFIER': {
            const val = token.value
            // .includes method
            if (val.includes('.includes:')) {
                const colonIdx = val.lastIndexOf('.includes:')
                const path = val.slice(0, colonIdx)
                const needle = val.slice(colonIdx + '.includes:'.length)
                const resolved = resolvePath(obj, path)
                if (typeof resolved === 'string') return resolved.toLowerCase().includes(needle.toLowerCase())
                if (Array.isArray(resolved)) return resolved.some(item => String(item).toLowerCase() === needle.toLowerCase())
                return false
            }
            // .startsWith method
            if (val.includes('.startsWith:')) {
                const colonIdx = val.lastIndexOf('.startsWith:')
                const path = val.slice(0, colonIdx)
                const prefix = val.slice(colonIdx + '.startsWith:'.length)
                const resolved = resolvePath(obj, path)
                if (typeof resolved === 'string') return resolved.toLowerCase().startsWith(prefix.toLowerCase())
                return false
            }
            // .endsWith method
            if (val.includes('.endsWith:')) {
                const colonIdx = val.lastIndexOf('.endsWith:')
                const path = val.slice(0, colonIdx)
                const suffix = val.slice(colonIdx + '.endsWith:'.length)
                const resolved = resolvePath(obj, path)
                if (typeof resolved === 'string') return resolved.toLowerCase().endsWith(suffix.toLowerCase())
                return false
            }
            // .matches method (regex)
            if (val.includes('.matches:')) {
                const colonIdx = val.lastIndexOf('.matches:')
                const path = val.slice(0, colonIdx)
                const pattern = val.slice(colonIdx + '.matches:'.length)
                const resolved = resolvePath(obj, path)
                if (typeof resolved === 'string') {
                    try { return new RegExp(pattern, 'i').test(resolved) } catch { return false }
                }
                return false
            }
            // .age pseudo-property for timestamp fields
            if (val.endsWith('.age')) {
                const path = val.slice(0, -4)
                const resolved = resolvePath(obj, path)
                if (typeof resolved === 'string') {
                    const date = new Date(resolved)
                    if (!isNaN(date.getTime())) return Date.now() - date.getTime()
                }
                return undefined
            }
            return resolvePath(obj, val)
        }
        default: return undefined
    }
}

function coerce(a: unknown, b: unknown): [unknown, unknown] {
    if (typeof b === 'number' && typeof a === 'string') {
        // Check if b is being compared against an age string
        const age = parseAge(a)
        if (age !== null) return [age, b]
        const n = Number(a)
        if (!isNaN(n)) return [n, b]
    }
    if (typeof a === 'number' && typeof b === 'string') {
        const age = parseAge(b)
        if (age !== null) return [a, age]
        const n = Number(b)
        if (!isNaN(n)) return [a, n]
    }
    return [a, b]
}

function compare(left: unknown, op: string, right: unknown): boolean {
    // Regex operators
    if (op === '=~' || op === '!~') {
        const str = String(left ?? '')
        let pattern: string
        let flags = 'i'
        if (typeof right === 'string' && right.startsWith('__regex__:')) {
            const parts = right.split(':')
            flags = parts[1] || 'i'
            pattern = parts.slice(2).join(':')
        } else {
            pattern = String(right ?? '')
        }
        try {
            const re = new RegExp(pattern, flags)
            return op === '=~' ? re.test(str) : !re.test(str)
        } catch { return false }
    }

    const [l, r] = coerce(left, right)
    switch (op) {
        case '===': case '==': return l === r
        case '!==': case '!=': return l !== r
        case '>': return (l as number) > (r as number)
        case '<': return (l as number) < (r as number)
        case '>=': return (l as number) >= (r as number)
        case '<=': return (l as number) <= (r as number)
        default: return false
    }
}

// Parse a set: ("val1", "val2", "val3")
function parseSet(tokens: Token[], pos: number, obj: unknown): { values: unknown[]; pos: number } {
    const values: unknown[] = []
    if (tokens[pos]?.type !== 'LPAREN') {
        // Single value, not a set
        values.push(resolveValue(tokens[pos], obj))
        return { values, pos: pos + 1 }
    }
    pos++ // skip LPAREN
    while (pos < tokens.length && tokens[pos]?.type !== 'RPAREN' && tokens[pos]?.type !== 'EOF') {
        values.push(resolveValue(tokens[pos], obj))
        pos++
        if (tokens[pos]?.type === 'COMMA') pos++ // skip comma
    }
    if (tokens[pos]?.type === 'RPAREN') pos++
    return { values, pos }
}

/**
 * Evaluate a single expression clause (no && / || at this level).
 */
function evalClause(tokens: Token[], pos: number, obj: unknown): { result: boolean; pos: number } {
    // !! prefix → truthiness check
    if (tokens[pos]?.type === 'NOT' && tokens[pos].value === '!!') {
        pos++
        const lhs = tokens[pos]
        pos++
        const val = resolveValue(lhs, obj)
        const result = val !== null && val !== undefined && val !== '' &&
            !(Array.isArray(val) && val.length === 0) &&
            !(typeof val === 'object' && val !== null && Object.keys(val).length === 0)
        return { result, pos }
    }

    // Single ! negation
    if (tokens[pos]?.type === 'NOT' && tokens[pos].value === '!') {
        pos++
        const inner = evalClause(tokens, pos, obj)
        return { result: !inner.result, pos: inner.pos }
    }

    // exists(path) → check if path resolves to a non-undefined value
    if (tokens[pos]?.type === 'EXISTS') {
        pos++
        // Expect LPAREN IDENTIFIER RPAREN
        if (tokens[pos]?.type === 'LPAREN') pos++
        const pathTok = tokens[pos]
        pos++
        if (tokens[pos]?.type === 'RPAREN') pos++
        const val = resolvePath(obj, pathTok.value)
        return { result: val !== undefined && val !== null, pos }
    }

    // Parenthesised sub-expression
    if (tokens[pos]?.type === 'LPAREN') {
        pos++
        const inner = evalFull(tokens, pos, obj)
        if (tokens[inner.pos]?.type === 'RPAREN') inner.pos++
        return { result: inner.result, pos: inner.pos }
    }

    // LHS
    const lhsTok = tokens[pos]
    pos++
    const lhs = resolveValue(lhsTok, obj)

    // If lhs resolves to a boolean (e.g. .includes()) and next token is not an OP
    if (typeof lhs === 'boolean' && tokens[pos]?.type !== 'OP' && tokens[pos]?.type !== 'IN' && tokens[pos]?.type !== 'NOT_IN') {
        return { result: lhs, pos }
    }

    // "in" operator: value in ("a", "b", "c")
    if (tokens[pos]?.type === 'IN') {
        pos++
        const { values, pos: newPos } = parseSet(tokens, pos, obj)
        const result = values.some(v => {
            const [a, b] = coerce(lhs, v)
            return a === b
        })
        return { result, pos: newPos }
    }

    // "not in" operator
    if (tokens[pos]?.type === 'NOT_IN') {
        pos++
        const { values, pos: newPos } = parseSet(tokens, pos, obj)
        const result = !values.some(v => {
            const [a, b] = coerce(lhs, v)
            return a === b
        })
        return { result, pos: newPos }
    }

    // Comparison operator
    if (tokens[pos]?.type === 'OP') {
        const op = tokens[pos].value
        pos++
        const rhsTok = tokens[pos]
        pos++
        const rhs = resolveValue(rhsTok, obj)
        return { result: compare(lhs, op, rhs), pos }
    }

    // Bare identifier → truthy check
    return { result: Boolean(lhs), pos }
}

function evalFull(tokens: Token[], pos: number, obj: unknown): { result: boolean; pos: number } {
    let { result, pos: p } = evalClause(tokens, pos, obj)

    while (tokens[p]?.type === 'AND' || tokens[p]?.type === 'OR') {
        const logOp = tokens[p].type
        p++
        const right = evalClause(tokens, p, obj)
        p = right.pos
        if (logOp === 'AND') result = result && right.result
        else result = result || right.result
    }

    return { result, pos: p }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate an expression string against a Kubernetes resource object.
 * Returns true if the resource matches, false otherwise.
 * Never throws — parse/eval errors return false.
 */
export function evaluate(expr: string, resource: unknown): boolean {
    try {
        const trimmed = expr.trim()
        if (!trimmed) return true
        const tokens = tokenize(trimmed)
        const { result } = evalFull(tokens, 0, resource)
        return result
    } catch {
        return false
    }
}

/**
 * Validate an expression string without evaluating it.
 * Returns null if valid, or an error message.
 */
export function validateExpression(expr: string): string | null {
    try {
        const trimmed = expr.trim()
        if (!trimmed) return null
        const tokens = tokenize(trimmed)
        evalFull(tokens, 0, {}) // dry-run against empty object
        return null
    } catch (e) {
        return String(e)
    }
}

/**
 * Get auto-complete suggestions based on a partial expression and known field paths.
 */
export function getSuggestions(partial: string, fieldPaths: string[]): string[] {
    const trimmed = partial.trim()
    if (!trimmed) return fieldPaths.slice(0, 10)

    // Find the last token being typed
    const parts = trimmed.split(/\s+/)
    const lastPart = parts[parts.length - 1] || ''

    // Suggest field paths
    const pathSuggestions = fieldPaths.filter(p => p.toLowerCase().startsWith(lastPart.toLowerCase()))
    // Suggest operators
    const operators = ['===', '!==', '>', '<', '>=', '<=', '&&', '||', 'in', 'not in', '=~', '!~']
    const opSuggestions = operators.filter(op => op.startsWith(lastPart))
    // Suggest methods
    const methods = ['.includes(', '.startsWith(', '.endsWith(', '.matches(', '.length', '.age']
    const methodSuggestions = methods.filter(m => m.startsWith(lastPart) || (lastPart.endsWith('.') && true))
    // Suggest functions
    const functions = ['exists(', '!!']
    const funcSuggestions = functions.filter(f => f.startsWith(lastPart))

    return [...funcSuggestions, ...pathSuggestions, ...methodSuggestions, ...opSuggestions].slice(0, 15)
}

/**
 * Extract all unique field paths from a Kubernetes resource for auto-complete.
 */
export function extractFieldPaths(obj: unknown, prefix = '', maxDepth = 5): string[] {
    if (maxDepth <= 0 || obj === null || obj === undefined) return []
    if (typeof obj !== 'object') return []

    const paths: string[] = []
    const record = obj as Record<string, unknown>

    for (const key of Object.keys(record)) {
        const fullPath = prefix ? `${prefix}.${key}` : key
        paths.push(fullPath)

        const val = record[key]
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            paths.push(...extractFieldPaths(val, fullPath, maxDepth - 1))
        }
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
            paths.push(`${fullPath}.length`)
            paths.push(...extractFieldPaths(val[0], `${fullPath}[0]`, maxDepth - 1))
        }
    }

    return paths
}

export interface ExpressionExample {
    label: string
    resourceHint?: string
    expression: string
    description?: string
}

export const EXPRESSION_EXAMPLES: ExpressionExample[] = [
    { label: 'Pod', resourceHint: 'pods', expression: 'status.phase !== "Running"', description: 'Find non-running pods' },
    { label: 'Pod', resourceHint: 'pods', expression: 'status.phase in ("Pending", "Failed", "Unknown")', description: 'Find problematic pods' },
    { label: 'Pod', resourceHint: 'pods', expression: 'metadata.name.matches("^web-.*")', description: 'Regex match pod names' },
    { label: 'All Resources', expression: 'metadata.labels["kubernetes.io/cluster-service"] === "true"', description: 'Find cluster services' },
    { label: 'All Resources', expression: 'metadata.creationTimestamp.age > "24h"', description: 'Resources older than 24 hours' },
    { label: 'ConfigMap', resourceHint: 'configmaps', expression: '!!data && metadata.labels.length > 0', description: 'ConfigMaps with data and labels' },
    { label: 'All Resources', expression: 'metadata.annotations["deployment.kubernetes.io/revision"] > 10', description: 'High revision count' },
    { label: 'Deployment', resourceHint: 'deployments', expression: 'spec.replicas >= 3 && metadata.name.startsWith("prod")', description: 'Production deployments with 3+ replicas' },
    { label: 'Job', resourceHint: 'jobs', expression: 'spec.suspend === false && status.succeeded > 0', description: 'Completed active jobs' },
    { label: 'Secret', resourceHint: 'secrets', expression: 'exists(metadata.labels["app"]) && !exists(metadata.annotations["deprecated"])', description: 'Active labeled secrets' },
    { label: 'Service', resourceHint: 'services', expression: 'spec.type not in ("ClusterIP") && !!spec.ports', description: 'Externally accessible services' },
    { label: 'Node', resourceHint: 'nodes', expression: 'metadata.labels["node-role.kubernetes.io/control-plane"] || metadata.labels["node-role.kubernetes.io/master"]', description: 'Find control plane nodes' },
]
