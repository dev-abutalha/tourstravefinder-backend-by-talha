import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Ticket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader } from '@/components/shared/ui-bits';

interface CouponRow {
  id: string;
  code: string;
  type: string;
  amount: number;
  description?: string;
  active: boolean;
  dateExpires?: string;
  usageCount?: number;
  usageLimit?: number;
  minimumAmount?: number;
  maximumAmount?: number;
}

const empty: CouponRow = {
  id: '',
  code: '',
  type: 'percent',
  amount: 10,
  description: '',
  active: true,
  usageLimit: 0,
  minimumAmount: 0,
  maximumAmount: 0,
};

export default function Coupons() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['coupons'], queryFn: () => api.get<CouponRow[]>('/admin/coupons'), select: (result) => result.data });
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CouponRow | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data ?? [];

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const payload = {
        code: editing.code,
        type: editing.type,
        amount: editing.amount,
        description: editing.description,
        active: editing.active,
        dateExpires: editing.dateExpires || undefined,
        usageLimit: editing.usageLimit,
        minimumAmount: editing.minimumAmount,
        maximumAmount: editing.maximumAmount,
      };
      if (editing.id) await api.put(`/admin/coupons/${editing.id}`, payload);
      else await api.post('/admin/coupons', payload);
      toast.success(editing.id ? 'Coupon updated' : 'Coupon created');
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['coupons'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Coupons"
        description="Discount codes applied at checkout."
        actions={
          <Button onClick={() => setEditing({ ...empty })}>
            <Plus className="size-4" /> New coupon
          </Button>
        }
      />

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Minimum</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <LoadingRows rows={5} cols={7} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={7} label="No coupons yet" />
            ) : (
              data.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-mono font-medium">
                      <Ticket className="size-4 text-muted-foreground" />
                      {coupon.code}
                    </div>
                    {coupon.description && <p className="text-xs text-muted-foreground">{coupon.description}</p>}
                  </TableCell>
                  <TableCell className="font-medium">
                    {coupon.type === 'percent' ? `${coupon.amount}%` : money(coupon.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {coupon.minimumAmount ? money(coupon.minimumAmount) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {coupon.usageCount ?? 0}
                    {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {coupon.dateExpires ? date(coupon.dateExpires) : 'Never'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={coupon.active ? 'default' : 'secondary'}>{coupon.active ? 'Active' : 'Inactive'}</Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing({ ...coupon })}>
                          <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(coupon)}>
                          <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit coupon' : 'New coupon'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input value={editing.code} onChange={(event) => setEditing({ ...editing, code: event.target.value.toUpperCase() })} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={editing.type} onValueChange={(value) => setEditing({ ...editing, type: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percentage</SelectItem>
                      <SelectItem value="fixed_cart">Fixed cart</SelectItem>
                      <SelectItem value="fixed_product">Fixed product</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount</Label>
                  <Input type="number" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: Number(event.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Expiry date</Label>
                  <Input
                    type="date"
                    value={editing.dateExpires ? editing.dateExpires.slice(0, 10) : ''}
                    onChange={(event) => setEditing({ ...editing, dateExpires: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Minimum spend</Label>
                  <Input type="number" value={editing.minimumAmount ?? 0} onChange={(event) => setEditing({ ...editing, minimumAmount: Number(event.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Usage limit</Label>
                  <Input type="number" value={editing.usageLimit ?? 0} onChange={(event) => setEditing({ ...editing, usageLimit: Number(event.target.value) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={2} value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.active} onCheckedChange={(value) => setEditing({ ...editing, active: value })} /> Active
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !editing?.code}>
              {busy ? 'Saving…' : 'Save coupon'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete coupon?"
        description={`“${deleteTarget?.code}” will stop working immediately.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/coupons/${deleteTarget.id}`);
            toast.success('Coupon deleted');
            void queryClient.invalidateQueries({ queryKey: ['coupons'] });
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
