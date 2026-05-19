import { parse as uuidParse, stringify as uuidStringify } from 'uuid';

export type UuidBlob = ArrayBuffer | Uint8Array;

export function normalizeUuid(value: string): string {
  return uuidFromBlob(uuidToBlob(value));
}

export function uuidToBlob(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError('Invalid UUID');

  try {
    return uuidParse(trimmed);
  } catch (error) {
    if (trimmed.includes('-')) throw error;
    return uuidParse(dashUuid(trimmed));
  }
}

export function tryUuidToBlob(value: string): Uint8Array | null {
  try {
    return uuidToBlob(value);
  } catch {
    return null;
  }
}

export function uuidFromBlob(value: UuidBlob): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return uuidStringify(bytes);
}

function dashUuid(value: string): string {
  if (value.length !== 32) throw new TypeError('Invalid UUID');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
