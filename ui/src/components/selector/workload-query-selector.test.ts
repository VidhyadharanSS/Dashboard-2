import { describe, expect, it } from 'vitest'

import {
  matchesRule,
  rulesToSelector,
  selectorToRules,
  splitSelectorParts,
} from './workload-query-selector.utils'

// Helpers -- strip random IDs so assertions stay deterministic
type RuleCore = { key: string; operator: string; values: string[] }
function strip(rules: ReturnType<typeof selectorToRules>): RuleCore[] {
  return rules.map(({ key, operator, values }) => ({ key, operator, values }))
}

describe('splitSelectorParts', () => {
  it('splits on top-level commas only', () => {
    expect(splitSelectorParts('app in (api,worker),!debug')).toEqual([
      'app in (api,worker)',
      '!debug',
    ])
  })

  it('handles a selector with no commas', () => {
    expect(splitSelectorParts('env=production')).toEqual(['env=production'])
  })

  it('returns empty array for empty string', () => {
    expect(splitSelectorParts('')).toEqual([])
  })

  it('trims surrounding whitespace from each part', () => {
    expect(splitSelectorParts(' foo , bar ')).toEqual(['foo', 'bar'])
  })

  it('does not split on commas inside nested parens', () => {
    expect(
      splitSelectorParts('tier notin (frontend,backend),region=eu-west-1')
    ).toEqual(['tier notin (frontend,backend)', 'region=eu-west-1'])
  })
})

describe('selectorToRules', () => {
  it('parses "app in (api,worker),!debug" correctly', () => {
    const rules = strip(selectorToRules('app in (api,worker),!debug'))
    expect(rules).toEqual([
      { key: 'app', operator: 'in', values: ['api', 'worker'] },
      { key: 'debug', operator: '!exists', values: [] },
    ])
  })

  it('parses = operator', () => {
    expect(strip(selectorToRules('env=production'))).toEqual([
      { key: 'env', operator: '=', values: ['production'] },
    ])
  })

  it('parses != operator', () => {
    expect(strip(selectorToRules('tier!=frontend'))).toEqual([
      { key: 'tier', operator: '!=', values: ['frontend'] },
    ])
  })

  it('parses notin operator', () => {
    const rules = strip(selectorToRules('tier notin (frontend,backend)'))
    expect(rules).toEqual([
      { key: 'tier', operator: 'notin', values: ['frontend', 'backend'] },
    ])
  })

  it('parses bare key as exists', () => {
    expect(strip(selectorToRules('app'))).toEqual([
      { key: 'app', operator: 'exists', values: [] },
    ])
  })

  it('parses !key as !exists', () => {
    expect(strip(selectorToRules('!beta'))).toEqual([
      { key: 'beta', operator: '!exists', values: [] },
    ])
  })

  it('returns empty array for empty input', () => {
    expect(selectorToRules('')).toEqual([])
    expect(selectorToRules('   ')).toEqual([])
  })

  it('handles multi-part mixed selector', () => {
    const rules = strip(
      selectorToRules('env=prod,tier!=frontend,app in (api,worker),!debug')
    )
    expect(rules).toEqual([
      { key: 'env', operator: '=', values: ['prod'] },
      { key: 'tier', operator: '!=', values: ['frontend'] },
      { key: 'app', operator: 'in', values: ['api', 'worker'] },
      { key: 'debug', operator: '!exists', values: [] },
    ])
  })
})

describe('rulesToSelector', () => {
  it('serialises in operator', () => {
    const rules = selectorToRules('app in (api,worker)')
    expect(rulesToSelector(rules)).toBe('app in (api,worker)')
  })

  it('serialises !exists operator', () => {
    const rules = selectorToRules('!debug')
    expect(rulesToSelector(rules)).toBe('!debug')
  })

  it('roundtrips complex selector', () => {
    const original = 'app in (api,worker),!debug'
    const rules = selectorToRules(original)
    expect(rulesToSelector(rules)).toBe(original)
  })

  it('roundtrips mixed selector', () => {
    const original = 'env=prod,tier!=frontend,app in (api,worker),!debug'
    expect(rulesToSelector(selectorToRules(original))).toBe(original)
  })

  it('skips rules with empty keys', () => {
    const rules = selectorToRules('env=prod')
    rules.push({ id: 'empty', key: '', operator: '=', values: ['x'] })
    expect(rulesToSelector(rules)).toBe('env=prod')
  })

  it('returns empty string when no rules', () => {
    expect(rulesToSelector([])).toBe('')
  })
})

describe('matchesRule', () => {
  it('in operator: matches when value is in the list', () => {
    const rule = selectorToRules('app in (api,worker)')[0]
    expect(matchesRule({ app: 'api' }, rule)).toBe(true)
    expect(matchesRule({ app: 'worker' }, rule)).toBe(true)
    expect(matchesRule({ app: 'scheduler' }, rule)).toBe(false)
  })

  it('!exists operator: true when key is absent', () => {
    const rule = selectorToRules('!debug')[0]
    expect(matchesRule({}, rule)).toBe(true)
    expect(matchesRule({ debug: 'true' }, rule)).toBe(false)
  })

  it('exists operator: true when key is present', () => {
    const rule = selectorToRules('app')[0]
    expect(matchesRule({ app: 'anything' }, rule)).toBe(true)
    expect(matchesRule({}, rule)).toBe(false)
  })

  it('= operator: matches exact value', () => {
    const rule = selectorToRules('env=prod')[0]
    expect(matchesRule({ env: 'prod' }, rule)).toBe(true)
    expect(matchesRule({ env: 'staging' }, rule)).toBe(false)
  })

  it('!= operator: matches when value differs', () => {
    const rule = selectorToRules('tier!=frontend')[0]
    expect(matchesRule({ tier: 'backend' }, rule)).toBe(true)
    expect(matchesRule({ tier: 'frontend' }, rule)).toBe(false)
  })

  it('notin operator: true when value not in list', () => {
    const rule = selectorToRules('tier notin (frontend,backend)')[0]
    expect(matchesRule({ tier: 'cache' }, rule)).toBe(true)
    expect(matchesRule({ tier: 'frontend' }, rule)).toBe(false)
  })

  it('smoke: all rules in "app in (api,worker),!debug" must match', () => {
    const rules = selectorToRules('app in (api,worker),!debug')
    const match = (labels: Record<string, string>) =>
      rules.every((r) => matchesRule(labels, r))
    expect(match({ app: 'api' })).toBe(true)
    expect(match({ app: 'worker' })).toBe(true)
    expect(match({ app: 'api', debug: 'true' })).toBe(false)
    expect(match({ app: 'other' })).toBe(false)
  })
})
