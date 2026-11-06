import { z } from 'zod'

// Use Zod's supported converter so API documentation shares the runtime schemas.
export function generateOpenApi(router: unknown, configuration: Record<string, any>) {
  const paths: Record<string, any> = {}
  const schemaOf = (schema: unknown) => schema instanceof z.ZodType
    ? z.toJSONSchema(schema, {
        target: 'openapi-3.0', io: 'input', unrepresentable: 'any',
        override: ({ zodSchema, jsonSchema }) => {
          if (zodSchema._zod.def.type === 'date') Object.assign(jsonSchema, { type: 'string', format: 'date-time' })
        },
      })
    : {}
  function visit(tree: unknown, names: string[] = []) {
    if (!tree || typeof tree !== 'object') return
    const route = tree as Record<string, any>
    if (typeof route.method !== 'string' || typeof route.path !== 'string') {
      for (const [name, child] of Object.entries(route)) visit(child, [...names, name])
      return
    }
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    const parameters: Record<string, unknown>[] = []
    for (const [kind, schema] of [['path', route.pathParams], ['query', route.query], ['header', route.headers]] as const) {
      if (!(schema instanceof z.ZodObject)) continue
      for (const [name, value] of Object.entries(schema.shape)) {
        if (!(value instanceof z.ZodType)) continue
        parameters.push({ name, in: kind, required: kind === 'path' || !value.isOptional(), schema: schemaOf(value) })
      }
    }
    for (const match of path.matchAll(/\{([^}]+)\}/g)) {
      if (!parameters.some(p => p.in === 'path' && p.name === match[1])) parameters.push({ name: match[1], in: 'path', required: true, schema: { type: 'string' } })
    }
    const responses = Object.fromEntries(Object.entries(route.responses || {}).map(([status, value]) => {
      const response = value && typeof value === 'object' && 'contentType' in value ? value as Record<string, unknown> : { body: value, contentType: 'application/json' }
      return [status, { description: 'Response ' + status, ...(response.body instanceof z.ZodType ? { content: { [String(response.contentType)]: { schema: schemaOf(response.body) } } } : {}) }]
    }))
    const operation: Record<string, unknown> = { operationId: names.join('_'), summary: route.summary, description: route.description, parameters, responses }
    if (route.body instanceof z.ZodType) operation.requestBody = { required: !route.body.isOptional(), content: { [route.contentType || 'application/json']: { schema: schemaOf(route.body) } } }
    ;(paths[path] ||= {})[route.method.toLowerCase()] = operation
  }
  visit(router)
  return { openapi: '3.0.3', ...configuration, paths }
}
