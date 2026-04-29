import { Link } from 'react-router-dom';

export interface NotFoundFallback {
  label: string;
  to: string;
}

export interface NotFoundProps {
  message?: string;
  fallbacks?: NotFoundFallback[];
}

export function NotFound({
  message = 'Page not found.',
  fallbacks = [{ label: 'Back to the dashboard', to: '/' }],
}: NotFoundProps = {}) {
  return (
    <section className="card not-found-card" data-testid="not-found">
      <div className="not-found-art" aria-hidden="true">
        <img
          src={`${import.meta.env.BASE_URL}icons/sad-face.svg`}
          className="not-found-art-img"
          alt=""
        />
      </div>
      <div className="not-found-copy">
        <h3>Not Found</h3>
        <p>{message}</p>
        {fallbacks.length > 0 && (
          <ul className="not-found-links">
            {fallbacks.map((f) => (
              <li key={`${f.to}::${f.label}`}>
                <Link to={f.to}>{f.label}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
