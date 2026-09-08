import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes, Span } from '@opentelemetry/api';

const OTEL_TRACER_NAME = 'vibe-dashboard.external-kanban';
const MAX_ATTRIBUTE_STRING_LENGTH = 160;
const SENSITIVE_ATTRIBUTE_KEY = /(?:authorization|cookie|token|secret|password|apikey|api_key|api-token|email|authheader|external_view_url|originalurl|url|jql|query|filter)/i;

export function getVdTracer() {
  return trace.getTracer(OTEL_TRACER_NAME);
}

export async function withOtelSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  return getVdTracer().startActiveSpan(name, { attributes: sanitizeOtelAttributes(attributes) }, async (span) => {
    const startedAt = performance.now();
    try {
      const result = await fn(span);
      span.setAttribute('vd.duration_ms', Math.round(performance.now() - startedAt));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setAttribute('vd.duration_ms', Math.round(performance.now() - startedAt));
      span.recordException({ name: error instanceof Error ? error.name : 'Error', message: safeErrorMessage(error) });
      span.setStatus({ code: SpanStatusCode.ERROR, message: safeErrorMessage(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function setOtelAttributes(span: Span, attributes: Record<string, unknown>): void {
  span.setAttributes(sanitizeOtelAttributes(attributes));
}

export function sanitizeOtelAttributes(attributes: Record<string, unknown>): Attributes {
  const sanitized: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_ATTRIBUTE_KEY.test(key)) continue;
    const sanitizedValue = sanitizeOtelAttributeValue(value);
    if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue;
  }
  return sanitized;
}

function sanitizeOtelAttributeValue(value: unknown): Attributes[string] | undefined {
  if (typeof value === 'string') return truncateAttributeString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const strings = value.every((item) => typeof item === 'string') ? value.map((item) => truncateAttributeString(item)) : undefined;
    if (strings) return strings;
    const numbers = value.every((item) => typeof item === 'number' && Number.isFinite(item)) ? value : undefined;
    if (numbers) return numbers;
    const booleans = value.every((item) => typeof item === 'boolean') ? value : undefined;
    if (booleans) return booleans;
  }
  return undefined;
}

function truncateAttributeString(value: string): string {
  return value.length > MAX_ATTRIBUTE_STRING_LENGTH ? `${value.slice(0, MAX_ATTRIBUTE_STRING_LENGTH)}…` : value;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return truncateAttributeString(error.name || 'Error');
  return 'Error';
}
