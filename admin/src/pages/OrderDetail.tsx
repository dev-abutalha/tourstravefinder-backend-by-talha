import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  FileText,
  Mail,
  ShieldAlert,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminItem } from '@/lib/hooks';
import { date, money, titleCase } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/ui-bits';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

interface OrderItem {
  _id: string;
  productTitle?: string;
  productSlug?: string;
  productImage?: string;
  optionName?: string;
  date?: string;
  time?: string;
  duration?: string;
  language?: string;
  travelers?: Record<string, number>;
  travelerCount?: number;
  unitPrice?: number;
  dynamicPrice?: number;
  total?: number;
}

interface Order {
  id: string;
  _id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  transactionId?: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  feeTotal: number;
  total: number;
  items: OrderItem[];
  customerEmail: string;
  customerPhone?: string;
  billing?: Record<string, string>;
  travelerCount: number;
  passengers: { firstName?: string; lastName?: string; passport?: string; nationality?: string; birthDate?: string; isLead?: boolean }[];
  extras: { label?: string; price?: number }[];
  pickupOption?: string;
  departureOption?: string;
  couponCode?: string;
  notes?: string;
  adminNotes?: string;
  ticketFiles: string[];
  ticketSentAt?: string;
  cancelRequested: boolean;
  cancelReason?: string;
  cancelRequestedAt?: string;
  cancelResolvedAt?: string;
  reviewEnabled: boolean;
  reviewSentAt?: string;
  reviewToken?: string;
  fraud: {
    level?: string;
    score?: number;
    reasons?: string[];
    reviewed?: boolean;
    ip?: string;
    fingerprint?: string;
    productKeys?: string[];
    context?: Record<string, unknown>;
  };
  attribution?: Record<string, string | number>;
  createdAt: string;
}

const statuses = ['pending', 'processing', 'on-hold', 'booking-confirm', 'completed', 'cancelled', 'refunded', 'failed', 'fraud-review'];

export default function OrderDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useAdminItem<Order>(['order', id], `/admin/orders/${id}`, Boolean(id));
  const order = query.data?.data;

  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [adminNotes, setAdminNotes] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [resolveOpen, setResolveOpen] = useState<'accept' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    await query.refetch();
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  async function run(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await task();
      toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading || !order) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const currentStatus = status || order.status;

  async function uploadTickets(files: FileList | null) {
    if (!files?.length) return;
    const payload = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<{ filename: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ filename: file.name, content: String(reader.result) });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      ),
    );
    await run(() => api.post(`/admin/orders/${id}/tickets`, { files: payload }), 'Tickets uploaded');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate('/orders')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">Placed {date(order.createdAt, true)}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/admin/orders/${id}/invoice`} target="_blank" rel="noreferrer">
              <FileText className="size-4" /> Invoice
            </a>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(() => api.post(`/admin/orders/${id}/review-request`), 'Review request sent')}
          >
            <Star className="size-4" /> Request review
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge status={order.status} />
              <span className="text-xs capitalize text-muted-foreground">Payment: {order.paymentStatus}</span>
            </div>
            <div className="space-y-2">
              <Label>Change status</Label>
              <Select value={currentStatus} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((value) => (
                    <SelectItem key={value} value={value}>
                      {titleCase(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={sendEmail} onCheckedChange={setSendEmail} /> Email the customer
              </label>
              <Button
                className="w-full"
                disabled={busy || currentStatus === order.status}
                onClick={() =>
                  run(
                    () => api.patch(`/admin/orders/${id}/status`, { status: currentStatus, note, sendEmail }),
                    'Status updated',
                  )
                }
              >
                Update status
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">
              {order.billing?.firstName} {order.billing?.lastName}
            </p>
            <p className="text-muted-foreground">{order.customerEmail}</p>
            {order.customerPhone && <p className="text-muted-foreground">{order.customerPhone}</p>}
            {order.billing?.address1 && (
              <p className="text-muted-foreground">
                {order.billing.address1}, {order.billing.city} {order.billing.postcode} {order.billing.country}
              </p>
            )}
            <Separator className="my-2" />
            <p className="text-xs text-muted-foreground">
              Payment method: <span className="capitalize text-foreground">{order.paymentMethod}</span>
            </p>
            {order.transactionId && <p className="text-xs text-muted-foreground">Txn: {order.transactionId}</p>}
            {order.couponCode && <p className="text-xs text-muted-foreground">Coupon: {order.couponCode}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={money(order.subtotal, order.currency)} />
            {order.discountTotal > 0 && <Row label="Discount" value={`-${money(order.discountTotal, order.currency)}`} />}
            {order.feeTotal > 0 && <Row label="Extras" value={money(order.feeTotal, order.currency)} />}
            <Separator className="my-2" />
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span>{money(order.total, order.currency)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {order.cancelRequested && (
        <Card className="border-amber-400/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              Cancellation requested
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Requested {date(order.cancelRequestedAt, true)} — “{order.cancelReason || 'No reason provided'}”
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setResolveOpen('accept')}>
                Accept & refund
              </Button>
              <Button size="sm" variant="outline" onClick={() => setResolveOpen('reject')}>
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {order.items.map((item) => (
            <div key={item._id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              {item.productImage && (
                <img src={item.productImage} alt="" className="size-14 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.productTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {[item.optionName, item.date, item.time, item.duration, item.language].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Object.entries(item.travelers ?? {})
                    .filter(([, count]) => Number(count) > 0)
                    .map(([category, count]) => `${count} ${category}`)
                    .join(', ')}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">{money(item.total ?? item.dynamicPrice, order.currency)}</p>
                <p className="text-xs text-muted-foreground">{money(item.unitPrice, order.currency)} / person</p>
              </div>
            </div>
          ))}
          {order.extras?.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">Extras</p>
              {order.extras.map((extra, index) => (
                <div key={index} className="flex justify-between text-muted-foreground">
                  <span>{extra.label}</span>
                  <span>{money(extra.price, order.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Travellers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {order.passengers.length === 0 && <p className="text-muted-foreground">No passenger details supplied.</p>}
            {order.passengers.map((passenger, index) => (
              <div key={index} className="rounded-lg border p-2.5">
                <p className="font-medium">
                  {passenger.firstName} {passenger.lastName} {passenger.isLead && <span className="text-xs text-primary">(lead)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[passenger.nationality, passenger.birthDate, passenger.passport].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            ))}
            {(order.pickupOption || order.departureOption) && (
              <p className="pt-2 text-xs text-muted-foreground">
                Pickup: {order.pickupOption || '—'} · Departure: {order.departureOption || '—'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4" /> Fraud shield
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <StatusBadge status={order.fraud.level} />
              <span className="text-muted-foreground">Score {order.fraud.score ?? 0}</span>
            </div>
            {order.fraud.reasons?.length ? (
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {order.fraud.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No risk signals recorded.</p>
            )}
            <p className="text-xs text-muted-foreground">IP: {order.fraud.ip || '—'}</p>
            <p className="text-xs text-muted-foreground">Fingerprint: {order.fraud.fingerprint || '—'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Tickets</CardTitle>
          <div className="flex gap-2">
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => uploadTickets(event.target.files)} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" /> Upload
            </Button>
            <Button
              size="sm"
              disabled={busy || order.ticketFiles.length === 0}
              onClick={() => run(() => api.post(`/admin/orders/${id}/tickets/send`), 'Tickets emailed')}
            >
              <Mail className="size-4" /> Send tickets
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.ticketFiles.length === 0 && <p className="text-sm text-muted-foreground">No tickets attached yet.</p>}
          {order.ticketFiles.map((file, index) => (
            <div key={file} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <FileText className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.split('/').pop()}</span>
              <Button variant="ghost" size="icon-sm" asChild>
                <a href={`/api/admin/orders/${id}/tickets/${index}/download`} target="_blank" rel="noreferrer">
                  <Download className="size-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => run(() => api.delete(`/admin/orders/${id}/tickets/${index}`), 'Ticket removed')}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          {order.ticketSentAt && (
            <p className="text-xs text-muted-foreground">Last sent {date(order.ticketSentAt, true)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Internal notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={adminNotes ?? order.adminNotes ?? ''}
            onChange={(event) => setAdminNotes(event.target.value)}
            placeholder="Only visible to the team…"
          />
          <Button
            size="sm"
            disabled={busy || adminNotes === null}
            onClick={() => run(() => api.patch(`/admin/orders/${id}/notes`, { adminNotes }), 'Notes saved')}
          >
            Save notes
          </Button>
          {order.notes && (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">Customer note: {order.notes}</p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={resolveOpen !== null}
        onOpenChange={(open) => !open && setResolveOpen(null)}
        title={resolveOpen === 'accept' ? 'Accept cancellation?' : 'Reject cancellation?'}
        description={
          <div className="space-y-2">
            <p>
              {resolveOpen === 'accept'
                ? 'The order will be cancelled, slots restored and the customer notified.'
                : 'The booking stays active and the customer is notified.'}
            </p>
            <Input
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Reason (optional)"
            />
          </div>
        }
        confirmLabel={resolveOpen === 'accept' ? 'Accept & refund' : 'Reject'}
        destructive={resolveOpen === 'accept'}
        onConfirm={async () => {
          await run(
            () => api.post(`/admin/orders/${id}/cancellation/resolve`, { decision: resolveOpen, reason: cancelReason }),
            'Cancellation resolved',
          );
          setCancelReason('');
        }}
      />
    </div>
  );
  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground">{value}</span>
      </div>
    );
  }
}
