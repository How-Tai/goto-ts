import { z } from 'zod'

export type KeywordRules = { requiredKeywords: string[]; bannedKeywords: string[] }
export const KeywordFailureSchema = z.object({
  code: z.literal('KEYWORD_REQUIREMENTS'),
  message: z.string(),
  requiredKeywords: z.array(z.string()),
  bannedKeywords: z.array(z.string()),
  missing: z.array(z.string()),
  banned: z.array(z.string()),
})
export const splitKeywords = (value: string) => [...new Set(value.split(/[\s,]+/).filter(Boolean))]
const keywordPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/
export const KeywordListInputSchema = z.string().max(4096).refine(value => {
  const words = splitKeywords(value)
  return words.length <= 64 && words.every(word => word.length <= 100 && keywordPattern.test(word))
}, 'Use up to 64 identifiers, separated by commas or spaces (for example: all_of, std::sort).')
export const KeywordRulesInputSchema = z.object({
  requiredKeywords: KeywordListInputSchema.optional(),
  bannedKeywords: KeywordListInputSchema.optional(),
}).refine(value => {
  const banned = splitKeywords(value.bannedKeywords ?? '')
  return !splitKeywords(value.requiredKeywords ?? '').some(word => banned.includes(word))
}, { message: 'A keyword cannot be both required and banned.', path: ['bannedKeywords'] })

// A basic lexical check, not proof that an algorithm is actually used.
export function codeWithoutCommentsAndStrings(source: string, language: string) {
  const python = language === 'py' || language === 'python'
  const code = python ? source : source.replace(/\\\r?\n/g, '')
  let output = '', i = 0
  while (i < code.length) {
    if (!python && code.startsWith('//', i) || python && code[i] === '#') {
      const end = code.indexOf('\n', i); i = end < 0 ? code.length : end; output += ' '; continue
    }
    if (!python && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2); i = end < 0 ? code.length : end + 2; output += ' '; continue
    }
    if (!python && code.startsWith('R"', i)) {
      const raw = /^R"([^\s()\\]{0,16})\(/.exec(code.slice(i))
      if (raw) {
        const ending = ')' + raw[1] + '"', end = code.indexOf(ending, i + raw[0].length)
        i = end < 0 ? code.length : end + ending.length; output += ' '; continue
      }
    }
    const quote = code[i]
    if (quote === '"' || quote === "'" && !(!python && /[0-9]/.test(code[i - 1] ?? '') && /[0-9]/.test(code[i + 1] ?? ''))) {
      const delimiter = python && code.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote
      i += delimiter.length
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue }
        if (code.startsWith(delimiter, i)) { i += delimiter.length; break }
        i++
      }
      output += ' '; continue
    }
    output += code[i++]
  }
  return output
}

export function checkKeywords(source: string, language: string, rules: KeywordRules) {
  const code = codeWithoutCommentsAndStrings(source, language)
  const contains = (word: string) => new RegExp('(^|[^A-Za-z0-9_])' + word.split('::').join('\\s*::\\s*') + '($|[^A-Za-z0-9_])').test(code)
  return {
    missing: rules.requiredKeywords.filter(word => !contains(word)),
    banned: rules.bannedKeywords.filter(contains),
  }
}
