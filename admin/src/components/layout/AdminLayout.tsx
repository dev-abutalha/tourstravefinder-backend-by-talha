import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Boxes,
  ChevronDown,
  ExternalLink,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Newspaper,
  Package,
  Percent,
  ShieldAlert,
  Star,
  Sun,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Commerce',
    items: [
      { to: '/orders', label: 'Orders', icon: Boxes },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/categories', label: 'Categories', icon: Tags },
      { to: '/coupons', label: 'Coupons', icon: Percent },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/posts', label: 'Blog posts', icon: Newspaper },
      { to: '/pages', label: 'Pages', icon: FileText },
      { to: '/faqs', label: 'FAQs', icon: HelpCircle },
      { to: '/showcases', label: 'Showcases', icon: BookOpen },
    ],
  },
  {
    title: 'Customers',
    items: [
      { to: '/reviews', label: 'Reviews', icon: Star },
      { to: '/users', label: 'Users', icon: Users },
      { to: '/messages', label: 'Messages', icon: MessageSquare },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/media', label: 'Media', icon: ImageIcon },
      { to: '/fraud', label: 'Fraud shield', icon: ShieldAlert },
      { to: '/settings', label: 'Settings', icon: BarChart3 },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('ttf_admin_theme') === 'dark';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('ttf_admin_theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          T
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">TTF Admin</p>
          <p className="text-[11px] text-sidebar-muted">Tours &amp; Travel</p>
        </div>
        <button className="ml-auto text-sidebar-muted lg:hidden" onClick={() => setMobileOpen(false)}>
          <X className="size-5" />
        </button>
      </div>
      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-white'
                        : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-white',
                    )
                  }
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-white"
        >
          <ExternalLink className="size-3.5" /> View website
        </a>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <div className="hidden text-sm text-muted-foreground sm:block">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon-sm" onClick={toggle} title="Toggle theme">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted">
                  <Avatar className="size-8">
                    {user?.avatar && <AvatarImage src={user.avatar} alt={user.displayName} />}
                    <AvatarFallback>{initials(user?.displayName || user?.email)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm font-medium leading-tight">{user?.displayName || 'Admin'}</span>
                    <span className="block text-[11px] capitalize text-muted-foreground">{user?.role}</span>
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')}>Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/users')}>Users</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
