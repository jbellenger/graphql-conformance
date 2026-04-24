import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="empty">
      <p>Not found.</p>
      <p>
        <Link to="/">Back to dashboard</Link>
      </p>
    </div>
  );
}
