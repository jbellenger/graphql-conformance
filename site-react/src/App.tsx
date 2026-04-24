import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { NotFound } from './routes/NotFound';

export function App() {
  return (
    <HashRouter>
      <header>
        <h1>
          <Link to="/">GraphQL Conformance</Link>
        </h1>
      </header>
      <main aria-label="Conformance dashboard">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
