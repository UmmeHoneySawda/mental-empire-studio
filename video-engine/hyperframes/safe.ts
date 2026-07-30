import type { JsonObject, JsonValue } from '../../shared/video-engine'

const HEX_COLOR = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('\r', '&#13;').replaceAll('\n', '&#10;')
}

export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

export function safeDomToken(value: string): string {
  let output = ''
  for (const character of value) {
    if (/^[A-Za-z0-9_-]$/.test(character)) {
      output += character
      continue
    }
    output += `_x${character.codePointAt(0)!.toString(16)}_`
  }
  return output || 'item'
}

export function seconds(frame: number, fps: number): string {
  const value = frame / fps
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function stringProp(
  props: JsonObject,
  key: string,
  fallback: string,
  maximumLength = 20_000,
): string {
  const value = props[key]
  return typeof value === 'string' ? value.slice(0, maximumLength) : fallback
}

export function optionalStringProp(
  props: JsonObject,
  key: string,
  maximumLength = 20_000,
): string | undefined {
  const value = props[key]
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, maximumLength)
    : undefined
}

export function numberProp(
  props: JsonObject,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = props[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value))
}

export function booleanProp(props: JsonObject, key: string, fallback: boolean): boolean {
  const value = props[key]
  return typeof value === 'boolean' ? value : fallback
}

export function colorProp(props: JsonObject, key: string, fallback: string): string {
  const value = props[key]
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

