export const Language = {
  cpp: 'cpp',
  c: 'c',
  python: 'python',
} as const
export type Language = keyof typeof Language

export const LanguageExtension: Record<Language, string> = {
  cpp: 'cpp',
  c: 'c',
  python: 'py',
}

export const LanguageName: Record<Language, string> = {
  cpp: 'C++',
  c: 'C',
  python: 'Python',
}
