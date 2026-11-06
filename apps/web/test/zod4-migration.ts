import assert from 'node:assert/strict'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { File } from '@web-std/file'
import { router } from '@otog/contract'
import { ContestModel } from '@otog/database'
import { generateOpenApi } from '../../api/src/utils/openapi'

async function main() {
  const times = ContestModel.pick({ timeStart: true, timeEnd: true })
  const parsed = times.parse({ timeStart: '2026-10-26T12:00:00Z', timeEnd: '2026-10-26T14:00:00Z' })
  assert(parsed.timeStart instanceof Date && parsed.timeEnd instanceof Date)
  assert.equal(times.safeParse({ timeStart: 'invalid', timeEnd: null }).success, false)
  const json = z.record(z.string(), z.unknown())
  assert.deepEqual(json.parse({ settings: { enabled: true }, count: 3 }), { settings: { enabled: true }, count: 3 })

  const schema = z.object({ sourceCode: z.instanceof(File), language: z.enum(['cpp', 'python']) })
  const resolve = zodResolver(schema)
  const options = { criteriaMode: 'all' as const, shouldUseNativeValidation: false, fields: {} }
  const accepted = await resolve({ sourceCode: new File(['int main() {}'], 'main.cpp'), language: 'cpp' }, {}, options)
  assert.deepEqual(accepted.errors, {})
  const rejected = await resolve({ sourceCode: null, language: 'other' } as never, {}, options)
  assert(rejected.errors.sourceCode && rejected.errors.language)

  const doc = generateOpenApi(router, { info: { title: 'OTOG API', version: '1.0' } })
  assert.equal(doc.openapi, '3.0.3')
  assert(Object.keys(doc.paths).length > 30)
  for (const [path, methods] of Object.entries(doc.paths)) {
    assert(!path.includes(':'))
    for (const operation of Object.values(methods) as Record<string, any>[]) {
      assert(Object.keys(operation.responses).length)
      for (const parameter of operation.parameters) if (parameter.in === 'path') assert.equal(parameter.required, true)
    }
  }
  const sample = generateOpenApi({ example: { method: 'POST', path: '/example/:id', query: z.object({ search: z.string().optional() }), body: z.object({ name: z.string() }), responses: { 200: z.object({ created: z.date() }), 204: null } } }, {})
  const route = sample.paths['/example/{id}'].post
  assert(route.parameters.some((p: any) => p.name === 'id' && p.required))
  assert(route.parameters.some((p: any) => p.name === 'search' && !p.required))
  assert.equal(route.requestBody.content['application/json'].schema.properties.name.type, 'string')
  assert.equal(route.responses[200].content['application/json'].schema.properties.created.format, 'date-time')
  assert.equal(route.responses[204].content, undefined)
  console.log(JSON.stringify({ passed: true, dateCoercion: true, formFileValidation: true, nestedFormErrors: true, documentedRoutes: Object.keys(doc.paths).length, openApiParameterAndDateCompatibility: true }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
