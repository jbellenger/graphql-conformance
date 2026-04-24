import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { ImplDetail } from './routes/ImplDetail';
import { NotFound } from './routes/NotFound';

export function App() {
  return (
    <HashRouter>
      <header className="site-header">
        <h1>
          <Link to="/">GraphQL Conformance</Link>
        </h1>
      </header>
      <main aria-label="Conformance dashboard">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/impl/:name" element={<ImplDetail />} />
          <Route path="/impl/:name/failures" element={<ImplDetail />} />
          <Route
            path="/impl/:name/failures/:testCaseId"
            element={<ImplDetail />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
