import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, LockKeyhole, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Login() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success('Welcome back');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(194,27,30,0.45),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(80,120,255,0.25),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary font-bold">T</span>
            <div>
              <p className="font-semibold">Tours &amp; Travel</p>
              <p className="text-xs text-white/60">Operations console</p>
            </div>
          </div>
          <div className="max-w-md">
            <h2 className="text-3xl font-semibold leading-tight">
              Run bookings, inventory and content from one place.
            </h2>
            <p className="mt-3 text-sm text-white/70">
              Manage tours, availability, orders, fraud review, customers and the entire website without touching
              WordPress.
            </p>
          </div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} Tours &amp; Travel Finder</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
              T
            </span>
            <span className="font-semibold">TTF Admin</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your administrator account to continue.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                  placeholder="admin@example.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pl-9"
                  placeholder="••••••••"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Sign in
            </Button>
          </form>

          <p className="mt-6 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Demo credentials: <span className="font-medium text-foreground">admin@example.com</span> /{' '}
            <span className="font-medium text-foreground">Admin@12345</span>
          </p>
        </div>
      </div>
    </div>
  );
}
