import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Mail, MailOpen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminList } from '@/lib/hooks';
import { date } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader, Pagination } from '@/components/shared/ui-bits';

interface MessageRow {
  id: string;
  type: 'contact' | 'newsletter';
  name?: string;
  email: string;
  subject?: string;
  message?: string;
  handled: boolean;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export default function Messages() {
  const queryClient = useQueryClient();
  const [type, setType] = useState('any');
  const [handled, setHandled] = useState('any');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MessageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageRow | null>(null);

  const { data, meta, loading, error } = useAdminList<MessageRow>(['messages'], '/admin/messages', {
    type,
    handled,
    page,
    limit: 25,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['messages'] });
  }

  async function toggleHandled(message: MessageRow) {
    try {
      await api.patch(`/admin/messages/${message.id}`, { handled: !message.handled });
      toast.success(message.handled ? 'Marked unread' : 'Marked handled');
      setSelected((prev) => (prev && prev.id === message.id ? { ...prev, handled: !prev.handled } : prev));
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Messages" description="Contact form submissions and newsletter sign-ups." />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={(value) => { setType(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All types</SelectItem>
            <SelectItem value="contact">Contact</SelectItem>
            <SelectItem value="newsletter">Newsletter</SelectItem>
          </SelectContent>
        </Select>
        <Select value={handled} onValueChange={(value) => { setHandled(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All</SelectItem>
            <SelectItem value="0">Unhandled</SelectItem>
            <SelectItem value="1">Handled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}

      {loading ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <tbody>
                <LoadingRows rows={6} cols={1} />
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <tbody>
                <EmptyRow colSpan={1} label="No messages" />
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y rounded-xl border bg-card shadow-sm">
          {data.map((message) => (
            <div
              key={message.id}
              className="flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-muted/40"
              onClick={() => setSelected(message)}
            >
              <div className="mt-0.5 text-muted-foreground">
                {message.handled ? <MailOpen className="size-4" /> : <Mail className="size-4 text-primary" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{message.name || message.email}</span>
                  <Badge variant="outline" className="capitalize">
                    {message.type}
                  </Badge>
                  {!message.handled && <Badge>New</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{date(message.createdAt, true)}</span>
                </div>
                {message.subject && <p className="text-sm font-medium">{message.subject}</p>}
                <p className="truncate text-sm text-muted-foreground">{message.message || '—'}</p>
              </div>
              <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                <Button variant="ghost" size="icon-sm" onClick={() => toggleHandled(message)} title="Toggle handled">
                  <Check className={message.handled ? 'size-4 text-muted-foreground' : 'size-4 text-emerald-600'} />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(message)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination meta={meta} onPage={setPage} />

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.subject || 'Message'}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">From</p>
                  <p className="font-medium">{selected.name || 'Anonymous'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <a href={`mailto:${selected.email}`} className="font-medium text-primary hover:underline">
                    {selected.email}
                  </a>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="capitalize">{selected.type}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Received</p>
                  <p>{date(selected.createdAt, true)}</p>
                </div>
              </div>
              <Separator />
              <p className="whitespace-pre-wrap text-muted-foreground">{selected.message || 'No message body.'}</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => toggleHandled(selected)}>
                  {selected.handled ? 'Mark unread' : 'Mark handled'}
                </Button>
                <Button variant="destructive" onClick={() => { setDeleteTarget(selected); setSelected(null); }}>
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete message?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/messages/${deleteTarget.id}`);
            toast.success('Message deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
