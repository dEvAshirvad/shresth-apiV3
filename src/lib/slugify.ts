export interface SlugifyOptions {
  separator?: string;
  lower?: boolean;
}

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const separator = options.separator ?? '-';
  const lower = options.lower ?? true;

  let value = input.normalize('NFKD');

  // Remove diacritics
  value = value.replace(/[\u0300-\u036f]/g, '');

  // Replace non-alphanumeric characters with separator
  value = value.replace(/[^a-zA-Z0-9]+/g, separator);

  // Trim separators from ends
  const pattern = new RegExp(`^${separator}+|${separator}+$`, 'g');
  value = value.replace(pattern, '');

  return lower ? value.toLowerCase() : value;
}

