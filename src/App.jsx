import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import { LoginPage, ResetPasswordPage } from './pages/AuthPages';
import RequireRole, { FullScreenMessage } from './auth/RequireRole';

// The admin bundle is only downloaded after RequireRole has confirmed the admin role.
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/admin/*"
        element={
          <RequireRole role="admin">
            <Suspense fallback={<FullScreenMessage icon="progress_activity" spin title="LOADING DASHBOARD…" />}>
              <AdminDashboard />
            </Suspense>
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
