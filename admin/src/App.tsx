import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { AdminLayout } from '@/components/layout/AdminLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Orders from '@/pages/Orders';
import OrderDetail from '@/pages/OrderDetail';
import Products from '@/pages/Products';
import ProductEdit from '@/pages/ProductEdit';
import Categories from '@/pages/Categories';
import Taxonomies from '@/pages/Taxonomies';
import Coupons from '@/pages/Coupons';
import Posts from '@/pages/Posts';
import Pages from '@/pages/Pages';
import Faqs from '@/pages/Faqs';
import Showcases from '@/pages/Showcases';
import Reviews from '@/pages/Reviews';
import Users from '@/pages/Users';
import Messages from '@/pages/Messages';
import Media from '@/pages/Media';
import Fraud from '@/pages/Fraud';
import Settings from '@/pages/Settings';

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="text-4xl font-semibold">404</p>
      <p className="text-muted-foreground">This page does not exist.</p>
      <a href="/admin" className="text-sm font-medium text-primary hover:underline">
        Back to dashboard
      </a>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Protected>
              <AdminLayout />
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductEdit />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/taxonomies" element={<Taxonomies />} />
          <Route path="/coupons" element={<Coupons />} />
          <Route path="/posts" element={<Posts />} />
          <Route path="/pages" element={<Pages />} />
          <Route path="/faqs" element={<Faqs />} />
          <Route path="/showcases" element={<Showcases />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/users" element={<Users />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/media" element={<Media />} />
          <Route path="/fraud" element={<Fraud />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
