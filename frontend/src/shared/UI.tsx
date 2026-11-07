import type { ReactNode } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="error">
      <AlertCircle size={19} />
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      Загрузка…
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Pagination({
  page,
  setPage,
  total,
}: {
  page: number;
  setPage: (page: number) => void;
  total?: number;
}) {
  return (
    <div className="pagination">
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>
        Назад
      </button>
      <span>Страница {page}</span>
      <button
        disabled={total !== undefined && page * 24 >= total}
        onClick={() => setPage(page + 1)}
      >
        Далее
      </button>
    </div>
  );
}
