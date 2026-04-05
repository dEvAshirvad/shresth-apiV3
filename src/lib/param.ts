/**
 * Coerce Express param (string | string[]) to string.
 * Express types params as string | string[]; use this when the service expects string.
 */
export function paramStr(p: string | string[] | undefined): string {
  if (p === undefined) return '';
  return Array.isArray(p) ? p[0] ?? '' : p;
}
