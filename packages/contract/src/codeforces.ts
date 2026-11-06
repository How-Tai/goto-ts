import { z } from 'zod'

const id = z.number().int().positive().max(2147483647)
const source = (bytes: number) =>
  z
    .string()
    .max(bytes)
    .refine(
      (v) => !v.includes('\0') && new TextEncoder().encode(v).length <= bytes,
      'Source/input must be bounded UTF-8 text without NUL characters'
    )
const tests = z
  .array(id)
  .min(1)
  .max(1000)
  .refine((v) => new Set(v).size === v.length, 'Duplicate test numbers')
export const CfContestForm = z
  .object({
    name: z.string().trim().min(1).max(200),
    timeStart: z.iso.datetime(),
    timeEnd: z.iso.datetime(),
    wrongPenalty: z.number().int().min(0).max(1000).default(50),
    minimumFraction: z.number().min(0).max(1).default(0.3),
    decayMinutes: z.number().min(1).max(100000).default(250),
    successfulHackPoints: z.number().int().min(0).max(1000).default(100),
    unsuccessfulHackPenalty: z.number().int().min(0).max(1000).default(50),
  })
  .strict()
  .refine(
    (v) => Date.parse(v.timeEnd) > Date.parse(v.timeStart),
    'End must follow start'
  )
export const CfProblemForm = z
  .object({
    problemId: id,
    letter: z.string().regex(/^[A-Z][0-9]?$/),
    points: z.number().int().min(1).max(100000),
    fullTests: tests,
    pretests: tests,
    validatorSource: source(24000).refine((v) => v.length > 0),
    referenceSource: source(24000).refine((v) => v.length > 0),
    checkerSource: source(24000).default(''),
    taskType: z.enum(['batch', 'library']).default('batch'),
    graderFiles: z
      .array(z.string().regex(/^[A-Za-z0-9_-]+\.(?:cpp|c)$/))
      .max(16)
      .default([]),
  })
  .strict()
  .refine(
    (v) => v.pretests.every((t) => v.fullTests.includes(t)),
    'Pretests must belong to full tests'
  )
  .refine(
    (v) => v.taskType !== 'library' || v.graderFiles.length > 0,
    'Library tasks require at least one grader source file'
  )
  .refine(
    (v) =>
      new Set(v.graderFiles).size === v.graderFiles.length &&
      v.graderFiles.every(
        (n) =>
          ![
            'solution.cpp',
            'solution.c',
            'check.cpp',
            'validator.cpp',
            'reference.cpp',
            'thaco.cpp',
            'partial.cpp',
          ].includes(n)
      ),
    'Duplicate or reserved grader filename'
  )
export const CfSubmitForm = z
  .object({
    problemId: id,
    language: z.enum(['cpp', 'c', 'python']),
    sourceCode: source(64000).refine((v) => v.length > 0),
    requestId: z.uuid(),
  })
  .strict()
export const CfHackForm = z
  .object({
    targetId: id,
    input: source(64000).refine((v) => v.length > 0),
    requestId: z.uuid(),
  })
  .strict()
export type CfContestSettings = z.infer<typeof CfContestForm>
export type CfProblemSettings = z.infer<typeof CfProblemForm>

export function cfPoints(
  points: number,
  minutes: number,
  attempts: number,
  settings: Pick<
    CfContestSettings,
    'minimumFraction' | 'decayMinutes' | 'wrongPenalty'
  >
) {
  return Math.floor(
    Math.max(
      points * settings.minimumFraction,
      points * (1 - Math.max(0, minutes) / settings.decayMinutes) -
        attempts * settings.wrongPenalty
    )
  )
}
