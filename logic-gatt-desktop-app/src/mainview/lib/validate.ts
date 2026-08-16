/**
 * Runtime validation schemas for API responses using Zod.
 */

import { z } from 'zod'

// ============================================================================
// Plugin API Schemas
// ============================================================================

/**
 * SelectOption from plugin select actions
 */
export const SelectOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

export type SelectOption = z.infer<typeof SelectOptionSchema>

export const SelectOptionsSchema = z.array(SelectOptionSchema)

/**
 * Status response from plugin status action
 */
export const StatusResponseSchema = z.object({
  running: z.boolean(),
  wsConnected: z.boolean().optional(),
})

export type StatusResponse = z.infer<typeof StatusResponseSchema>

// ============================================================================
// Validation helpers
// ============================================================================

export interface ValidationResult<T> {
  success: boolean
  data: T | null
  error: string | null
}

/**
 * Safely parse data with a zod schema, returning a result object
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data, error: null }
  }
  return {
    success: false,
    data: null,
    error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
  }
}

/**
 * Validate select options response
 */
export function validateSelectOptions(data: unknown): ValidationResult<SelectOption[]> {
  return safeParse(SelectOptionsSchema, data)
}

/**
 * Validate status response
 */
export function validateStatusResponse(data: unknown): ValidationResult<StatusResponse> {
  return safeParse(StatusResponseSchema, data)
}
