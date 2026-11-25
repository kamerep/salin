import { useEffect, type ReactNode } from 'react';

export function PageHead({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  useEffect(() => { document.title = `${title} | Salin`; }, [title]);
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title" id="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
