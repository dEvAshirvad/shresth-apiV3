import multer, { type FileFilterCallback, type Multer } from 'multer';
import path from 'node:path';
import fs from 'node:fs';

/** Default TTL for temporary uploads: 10 minutes (ms) */
const DEFAULT_TEMPORARY_TTL_MS = 10 * 60 * 1000;

/** Temp directory for uploads (deleted after processing or TTL) */
const UPLOAD_TEMP = path.join(process.cwd(), 'uploads', 'temp');
/** Persistent uploads directory (when not temporary) */
const UPLOAD_PERSIST = path.join(process.cwd(), 'uploads', 'persist');

/** Extension → allowed MIME types (lowercase). Add more as needed. */
const EXT_TO_MIMETYPES: Record<string, string[]> = {
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
  jpeg: ['image/jpeg'],
  jpg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
};

export function ensureUploadDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** @deprecated Use ensureUploadDir(UPLOAD_TEMP) or createUploadMiddleware. */
export function ensureTempDir(): string {
  return ensureUploadDir(UPLOAD_TEMP);
}

/** Schedule a file to be deleted after `ttlMs`. Defaults to DEFAULT_TEMPORARY_TTL_MS. */
export function scheduleTempFileRemoval(
  filePath: string,
  ttlMs: number = DEFAULT_TEMPORARY_TTL_MS
): void {
  if (!filePath) return;
  setTimeout(() => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore cleanup errors
    }
  }, ttlMs);
}

export interface CreateUploadOptions {
  /** If true, files go to temp dir and can be removed after temporaryTTL. Default: true */
  isTemporary?: boolean;
  /** TTL in ms for temporary files before auto-removal. Default: 10 minutes */
  temporaryTTL?: number;
  /** Allowed file extensions (e.g. ['csv', 'jpeg']). No leading dot. Default: ['csv'] */
  fileextacceptArr?: string[];
  /** Max file size in bytes. Default: 5MB */
  fileSizeLimit?: number;
  /** Prefix for stored filename. Default: 'upload' */
  filePrefix?: string;
}

export interface CreateUploadResult {
  /** Multer middleware to use in routes (e.g. .single('file'), .array('files')) */
  middleware: Multer;
  /** Call after handling the request to schedule removal of temp file(s). No-op if not temporary. */
  scheduleRemoval: (filePathOrPaths: string | string[]) => void;
}

/**
 * Single factory for multer upload config. Use in every upload endpoint.
 *
 * @example
 * const { middleware, scheduleRemoval } = createUploadMiddleware({
 *   isTemporary: true,
 *   temporaryTTL: 10 * 60 * 1000,
 *   fileextacceptArr: ['csv', 'jpeg'],
 * });
 * router.post('/import', middleware.single('file'), (req, res) => {
 *   // ... process req.file ...
 *   if (req.file?.path) scheduleRemoval(req.file.path);
 * });
 */
export function createUploadMiddleware(
  options: CreateUploadOptions = {}
): CreateUploadResult {
  const {
    isTemporary = true,
    temporaryTTL = DEFAULT_TEMPORARY_TTL_MS,
    fileextacceptArr = ['csv'],
    fileSizeLimit = 5 * 1024 * 1024,
    filePrefix = 'upload',
  } = options;

  const destinationDir = isTemporary ? UPLOAD_TEMP : UPLOAD_PERSIST;
  const normalizedExts = fileextacceptArr.map((e) =>
    e.toLowerCase().replace(/^\./, '')
  );

  const storage = multer.diskStorage({
    destination: (
      _req: unknown,
      _file: unknown,
      cb: (error: Error | null, destination: string) => void
    ) => {
      cb(null, ensureUploadDir(destinationDir));
    },
    filename: (
      _req: unknown,
      file: { originalname: string },
      cb: (error: Error | null, filename: string) => void
    ) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const ext =
        path.extname(file.originalname).toLowerCase() ||
        `.${normalizedExts[0] ?? 'bin'}`;
      cb(null, `${filePrefix}-${unique}${ext}`);
    },
  });

  const allowedMimes = new Set<string>();
  for (const ext of normalizedExts) {
    const mimes = EXT_TO_MIMETYPES[ext];
    if (mimes) mimes.forEach((m) => allowedMimes.add(m));
  }

  const fileFilter = (
    _req: unknown,
    file: { mimetype: string; originalname: string },
    cb: FileFilterCallback
  ) => {
    const ext =
      path.extname(file.originalname).toLowerCase().replace(/^\./, '') || '';
    const extAllowed = normalizedExts.includes(ext);
    const mimeAllowed =
      allowedMimes.size === 0 || allowedMimes.has(file.mimetype?.toLowerCase());
    const ok = extAllowed && (allowedMimes.size === 0 || mimeAllowed);
    cb(null, !!ok);
  };

  const middleware = multer({
    storage,
    limits: { fileSize: fileSizeLimit },
    fileFilter,
  });

  const scheduleRemoval = (filePathOrPaths: string | string[]) => {
    if (!isTemporary) return;
    const paths = Array.isArray(filePathOrPaths)
      ? filePathOrPaths
      : [filePathOrPaths];
    paths.forEach((p) => scheduleTempFileRemoval(p, temporaryTTL));
  };

  return { middleware, scheduleRemoval };
}
