/**
 * Pure utility functions for building and parsing Kubernetes label selectors.
 * Kept in a separate module so they can be unit-tested without a DOM environment.
 */

export type Operator = '=' | '!=' | 'in' | 'notin' | 'exists' | '!exists'

export interface QueryRule {
    id: string
    key: string
    operator: Operator
    values: string[]
}

export function createRule(partial?: Partial<QueryRule>): QueryRule {
    return {
        id: Math.random().toString(36).slice(2, 9),
        key: partial?.key || '',
        operator: partial?.operator || '=',
        values: partial?.values || [''],
    }
}

/**
 * Splits a selector string on top-level commas (i.e. commas that are NOT
 * inside parentheses).  For example:
 *   "app in (api,worker),!debug"  →  ["app in (api,worker)", "!debug"]
 */
export function splitSelectorParts(selector: string): string[] {
    const parts: string[] = []
    let current = ''
    let depth = 0

    for (const char of selector) {
        if (char === '(') depth += 1
        if (char === ')') depth = Math.max(0, depth - 1)
        if (char === ',' && depth === 0) {
            if (current.trim()) parts.push(current.trim())
            current = ''
            continue
        }
        current += char
    }

    if (current.trim()) parts.push(current.trim())
    return parts
}

/**
 * Parses a Kubernetes label selector string into an array of QueryRules.
 * Supports =, !=, in(), notin(), exists (bare key), and !exists (!key).
 */
export function selectorToRules(selector: string): QueryRule[] {
    if (!selector.trim()) return []
    return splitSelectorParts(selector).map((part) => {
        const inMatch = part.match(/^(.+?)\s+in\s+\((.+)\)$/)
        if (inMatch) {
            return createRule({ key: inMatch[1].trim(), operator: 'in', values: inMatch[2].split(',').map((v) => v.trim()) })
        }

        const notinMatch = part.match(/^(.+?)\s+notin\s+\((.+)\)$/)
        if (notinMatch) {
            return createRule({ key: notinMatch[1].trim(), operator: 'notin', values: notinMatch[2].split(',').map((v) => v.trim()) })
        }

        if (part.startsWith('!')) {
            return createRule({ key: part.slice(1).trim(), operator: '!exists', values: [] })
        }

        if (part.includes('!=')) {
            const [key, ...rest] = part.split('!=')
            return createRule({ key: key.trim(), operator: '!=', values: [rest.join('!=').trim()] })
        }

        if (part.includes('=')) {
            const [key, ...rest] = part.split('=')
            return createRule({ key: key.trim(), operator: '=', values: [rest.join('=').trim()] })
        }

        return createRule({ key: part.trim(), operator: 'exists', values: [] })
    })
}

/**
 * Serialises an array of QueryRules back into a Kubernetes label selector
 * string.  Rules whose key is empty are skipped.
 */
export function rulesToSelector(rules: QueryRule[]): string {
    return rules
        .filter((rule) => rule.key.trim() !== '')
        .map((rule) => {
            const key = rule.key.trim()
            switch (rule.operator) {
                case '=':
                    return `${key}=${rule.values[0] || ''}`
                case '!=':
                    return `${key}!=${rule.values[0] || ''}`
                case 'in':
                    return `${key} in (${rule.values.filter(Boolean).join(',')})`
                case 'notin':
                    return `${key} notin (${rule.values.filter(Boolean).join(',')})`
                case 'exists':
                    return key
                case '!exists':
                    return `!${key}`
                default:
                    return ''
            }
        })
        .filter(Boolean)
        .join(',')
}

/**
 * Returns true when a given pod's label map satisfies the supplied rule.
 */
export function matchesRule(labels: Record<string, string>, rule: QueryRule): boolean {
    const key = rule.key.trim()
    if (!key) return true
    const value = labels[key]
    switch (rule.operator) {
        case '=':
            return value === (rule.values[0] || '')
        case '!=':
            return value !== (rule.values[0] || '')
        case 'in':
            return rule.values.includes(value || '')
        case 'notin':
            return !rule.values.includes(value || '')
        case 'exists':
            return key in labels
        case '!exists':
            return !(key in labels)
        default:
            return true
    }
}
