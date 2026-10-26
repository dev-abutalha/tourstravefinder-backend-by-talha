import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Filter, ShieldAlert } from 'lucide-react';
import { useAdminList } from '@/lib/hooks';
import { money, date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  EmptyRow,
  LoadingRows,
  PageHeader,
  Pagination,
  SearchInput,
  StatusBadge,
} from '@/components/shared/ui-bits';
import { useDebounced } from '@/lib/hooks';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  itemCount: number;
  firstItemTitle: string;
  travelerCount: number;
  fraudLevel: string;
  fraudScore: number;
  cancelRequested: boolean;
  createdAt: string;
}

const statuses = [
  ['any', 'All statuses'],
  ['pending', 'Pending'],
  ['processing', 'Processing'],
  ['on-hold', 'On hold'],
  ['booking-confirm', 'Booking confirmed'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
  ['failed', 'Failed'],
  ['fraud-review', 'Fraud review'],
];

const dateRanges = [
  ['any', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7days', 'Last 7 days'],
  ['30days', 'Last 30 days'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_year', 'This year'],
  ['last_year', 'Last year'],
];

export default function Orders() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('any');
  const [dateRange, setDateRange] = useState('any');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const { data, meta, loading, error } = useAdminList<OrderRow>(['orders'], '/admin/orders', {
    search: debounced || undefined,
    status,
    dateRange,
    page,
    limit: 20,
  });

  function exportCsv() {
    const query = new URLSearchParams({ status, dateRange });
    if (debounced) query.set('search', debounced);
    window.open(`/api/admin/orders/export/csv?${query.toString()}`, '_blank');
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Every booking, payment and cancellation request."
        actions={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search order, email or name…" className="w-full sm:w-72" />
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger className="w-44">
            <Filter className="size-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={(value) => { setDateRange(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dateRanges.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Placed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows rows={8} cols={7} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={7} label="No orders match these filters" />
            ) : (
              data.map((order) => (
                <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${order.id}`)}>
                  <TableCell>
                    <div className="font-medium">{order.orderNumber}</div>
                    {order.fraudLevel !== 'allowed' && (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-destructive">
                        <ShieldAlert className="size-3" /> Fraud {order.fraudLevel} ({order.fraudScore})
                      </span>
                    )}
                    {order.cancelRequested && (
                      <span className="mt-0.5 block text-[11px] text-amber-600">Cancellation requested</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.customerName || 'Guest'}</div>
                    <div className="text-xs text-muted-foreground">{order.customerEmail}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-52 truncate text-sm">{order.firstItemTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {order.itemCount} item(s) · {order.travelerCount} traveller(s)
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{money(order.total, order.currency)}</TableCell>
                  <TableCell>
                    <div className="capitalize">{order.paymentMethod}</div>
                    <div className="text-xs capitalize text-muted-foreground">{order.paymentStatus}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{date(order.createdAt, true)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={meta} onPage={setPage} />
    </div>
  );
}
