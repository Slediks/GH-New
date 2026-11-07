export interface UploadLimits {
  cover_bytes: number;
  html_bytes: number;
}

export const megabytes = (bytes: number) => bytes / 1024 ** 2;

export function uploadError(file: File | null, limit: number, kind: 'cover' | 'html') {
  if (!file?.size) return '';
  if (file.size > limit)
    return `Максимальный размер ${kind === 'cover' ? 'обложки' : 'HTML-файла'} — ${megabytes(limit)} МБ.`;
  return '';
}
