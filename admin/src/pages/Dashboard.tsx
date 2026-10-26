import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, Boxes, Euro, ShieldAlert, ShoppingBag, Star, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, StatCard } from '@/components/shared/ui-bits';
import { Button } from '@/components/ui/button';

interface DashboardData {
  stats: {
    totalOrders: number;
    ordersToday: number;
    revenueMonth: number;
    revenueToday: number;
    ordersMonth: number;
    pendingOrders: number;
    reviews: number;
    averageRating: number;
    products: number;
    customers: number;
    fraudReview: number;
  };
  recentOrders: { id: string; orderNumber: string; status: string; total: number; customerEmail: string; createdAt: string }[];
  revenueSeries: { date: string; revenue: number; orders: number }[];
  topProducts: { id: string; title: string; revenue: number; sold: number }[];
}

export default function Dashboard() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/admin/dashboard'),
    select: (result) => result.data,
  });

  const data = query.data;

  if (query.isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const stats = data.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">A live snapshot of bookings and revenue.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/orders">
            View all orders <ArrowUpRight className="size-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue this month"
          value={money(stats.revenueMonth)}
          hint={`${money(stats.revenueToday)} today`}
          icon={<Euro className="size-4" />}
          accent
        />
        <StatCard
          label="Orders this month"
          value={stats.ordersMonth.toLocaleString()}
          hint={`${stats.ordersToday} today · ${stats.pendingOrders} awaiting action`}
          icon={<ShoppingBag className="size-4" />}
        />
        <StatCard
          label="Published products"
          value={stats.products.toLocaleString()}
          hint={`${stats.totalOrders.toLocaleString()} orders all time`}
          icon={<Boxes className="size-4" />}
        />
        <StatCard
          label="Customers"
          value={stats.customers.toLocaleString()}
          hint={`${stats.reviews} reviews · ${stats.averageRating}★ average`}
          icon={<Users className="size-4" />}
        />
      </div>

      {stats.fraudReview > 0 && (
        <Link
          to="/fraud"
          className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm transition hover:bg-destructive/10"
        >
          <ShieldAlert className="size-5 text-destructive" />
          <span className="font-medium">{stats.fraudReview} orders need fraud review</span>
          <span className="ml-auto text-xs text-muted-foreground">Open fraud shield →</span>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Revenue</CardTitle>
            <span className="text-xs text-muted-foreground">Last 30 days</span>
          </CardHeader>
          <CardContent className="h-72">
            {data.revenueSeries.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No revenue recorded yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenueSeries} margin={{ left: -10, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => value.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(value: number) => `€${value}`}
                  />
                  <ChartTooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--popover)',
                      fontSize: 12,
                    }}
                    formatter={(value) => [money(Number(value ?? 0)), 'Revenue']}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#revenue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topProducts.length === 0 && (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            )}
            {data.topProducts.map((product, index) => (
              <div key={product.id} className="flex items-center gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{product.title}</p>
                  <p className="text-xs text-muted-foreground">{product.sold} travellers</p>
                </div>
                <span className="text-sm font-medium">{money(product.revenue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent orders</CardTitle>
          <Link to="/orders" className="text-xs font-medium text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {data.recentOrders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
          {data.recentOrders.map((order) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <ShoppingBag className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{order.orderNumber}</p>
                <p className="truncate text-xs text-muted-foreground">{order.customerEmail}</p>
              </div>
              <StatusBadge status={order.status} />
              <span className="w-20 text-right text-sm font-medium">{money(order.total)}</span>
              <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">
                {relative(order.createdAt)}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Star className="size-3.5" /> Average rating {stats.averageRating} from {stats.reviews} approved reviews.
      </div>
    </div>
  );
}
