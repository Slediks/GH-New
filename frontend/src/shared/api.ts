let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const form = data instanceof FormData;
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(form && path.startsWith('/arena/assets-admin') ? 120000 : 15000),
    headers: {
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      ...(!form && data !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: data === undefined ? undefined : form ? data : JSON.stringify(data),
  }).catch(() => {
    throw new ApiError('Нет связи с сервером. Попробуйте ещё раз.', 0);
  });
  const payload = await response.json().catch(() => {
    throw new ApiError('Сервер временно недоступен', response.status);
  });
  if (!response.ok)
    throw new ApiError(payload.error?.message ?? 'Не удалось выполнить запрос', response.status);
  return payload as T;
}
export function points(value: number) {
  return (value / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
export function date(value: number | null) {
  return value ? new Date(value * 1000).toLocaleString('ru-RU') : 'Ожидается';
}
export const phases: Record<string, string> = {
  scheduled: 'По расписанию',
  betting_open: 'Приём ставок',
  live: 'Прямой эфир',
  penalties: 'Пенальти',
  finished: 'Завершён',
  cancelled: 'Отменён',
};
