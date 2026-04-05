/**
 * JSON Serializer for consistent API responses
 * Handles data transformation, field selection, and serialization
 */

/**
 * Serialization options
 */
export interface SerializeOptions {
  fields?: string[]; // Fields to include
  exclude?: string[]; // Fields to exclude
  transform?: (data: unknown) => unknown; // Custom transformation function
}

/**
 * Type guard to check if value is a record
 */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value)
  );
};

/**
 * Serialize a single object
 */
export const serialize = <T extends Record<string, unknown>>(
  data: T,
  options: SerializeOptions = {}
): Partial<T> => {
  const { fields, exclude, transform } = options;

  // Apply custom transformation first
  let serialized: Record<string, unknown> = transform
    ? (transform(data) as Record<string, unknown>)
    : data;

  // Ensure serialized is a record
  if (!isRecord(serialized)) {
    serialized = data;
  }

  // If fields are specified, only include those
  if (fields && fields.length > 0) {
    const filtered: Partial<T> = {};
    for (const field of fields) {
      if (field in serialized) {
        filtered[field as keyof T] = serialized[field] as T[keyof T];
      }
    }
    serialized = filtered as Record<string, unknown>;
  }

  // Remove excluded fields
  if (exclude && exclude.length > 0) {
    const filtered: Record<string, unknown> = { ...serialized };
    for (const field of exclude) {
      delete filtered[field];
    }
    serialized = filtered;
  }

  return serialized as Partial<T>;
};

/**
 * Serialize an array of objects
 */
export const serializeArray = <T extends Record<string, unknown>>(
  data: T[],
  options: SerializeOptions = {}
): Partial<T>[] => {
  return data.map((item) => serialize(item, options));
};

/**
 * Common serialization patterns
 */
export class Serializer {
  /**
   * Serialize user data (exclude sensitive fields)
   */
  static user<T extends Record<string, unknown>>(data: T): Partial<T> {
    return serialize(data, {
      exclude: ['password', 'refreshToken', 'resetToken', '__v'],
    });
  }

  /**
   * Serialize user array
   */
  static users<T extends Record<string, unknown>>(data: T[]): Partial<T>[] {
    return serializeArray(data, {
      exclude: ['password', 'refreshToken', 'resetToken', '__v'],
    });
  }

  /**
   * Serialize with only specified fields
   */
  static only<T extends Record<string, unknown>>(
    data: T,
    fields: string[]
  ): Partial<T> {
    return serialize(data, { fields });
  }

  /**
   * Serialize array with only specified fields
   */
  static onlyArray<T extends Record<string, unknown>>(
    data: T[],
    fields: string[]
  ): Partial<T>[] {
    return serializeArray(data, { fields });
  }

  /**
   * Serialize excluding specified fields
   */
  static except<T extends Record<string, unknown>>(
    data: T,
    exclude: string[]
  ): Partial<T> {
    return serialize(data, { exclude });
  }

  /**
   * Serialize array excluding specified fields
   */
  static exceptArray<T extends Record<string, unknown>>(
    data: T[],
    exclude: string[]
  ): Partial<T>[] {
    return serializeArray(data, { exclude });
  }

  /**
   * Custom serialization with transformation
   */
  static custom<T extends Record<string, unknown>>(
    data: T,
    transform: (data: T) => unknown
  ): unknown {
    return serialize(data, {
      transform: (data: unknown) => transform(data as T),
    });
  }
}

/**
 * Transform Mongoose document to plain object
 */
export const toPlainObject = <T>(doc: any): T => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ virtuals: true }) as T;
  }
  if (typeof doc.toJSON === 'function') {
    return doc.toJSON() as T;
  }
  return doc as T;
};

/**
 * Transform array of Mongoose documents
 */
export const toPlainObjectArray = <T>(docs: any[]): T[] => {
  return docs.map((doc) => toPlainObject<T>(doc));
};
