import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { slugify } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader } from '@/components/shared/ui-bits';

interface ShowcaseItem {
  title?: string;
  subtitle?: string;
  description?: string;
  image?: string;
  link?: string;
  pageTitle?: string;
  order?: number;
}

interface ShowcaseRow {
  id: string;
  kind: 'destination' | 'attraction';
  title: string;
  slug: string;
  status?: string;
  subtitle?: string;
  description?: string;
  items?: ShowcaseItem[];
}

const empty: ShowcaseRow = {
  id: '',
  kind: 'destination',
  title: '',
  slug: '',
  status: 'publish',
  subtitle: '',
  description: '',
  items: [],
};

export default function Showcases() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['showcases'], queryFn: () => api.get<ShowcaseRow[]>('/admin/showcases'), select: (result) => result.data });
  const [editing, setEditing] = useState<ShowcaseRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShowcaseRow | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['showcases'] });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...payload } = editing;
      if (id) await api.put(`/admin/showcases/${id}`, payload);
      else await api.post('/admin/showcases', payload);
      toast.success(id ? 'Showcase saved' : 'Showcase created');
      setEditing(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function setItem(index: number, patch: Partial<ShowcaseItem>) {
    if (!editing) return;
    setEditing({ ...editing, items: (editing.items ?? []).map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Showcases"
        description="“Top destinations” and “Top attractions” carousels on the homepage."
        actions={
          <Button onClick={() => setEditing({ ...empty, items: [] })}>
            <Plus className="size-4" /> New showcase
          </Button>
        }
      />

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Showcase</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <LoadingRows rows={5} cols={5} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={5} label="No showcases yet" />
            ) : (
              data.map((showcase) => (
                <TableRow key={showcase.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <MapPin className="size-4 text-muted-foreground" />
                      {showcase.title}
                    </div>
                    {showcase.subtitle && <p className="text-xs text-muted-foreground">{showcase.subtitle}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={showcase.kind === 'destination' ? 'default' : 'secondary'} className="capitalize">
                      {showcase.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{showcase.items?.length ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={showcase.status === 'draft' ? 'secondary' : 'outline'} className="capitalize">
                      {showcase.status ?? 'publish'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ ...showcase, items: showcase.items ?? [] })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(showcase)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit showcase' : 'New showcase'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input
                    value={editing.title}
                    onChange={(event) => setEditing({ ...editing, title: event.target.value, slug: editing.slug || slugify(event.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug</Label>
                  <Input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Kind</Label>
                  <Select value={editing.kind} onValueChange={(value) => setEditing({ ...editing, kind: value as ShowcaseRow['kind'] })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="destination">Top destinations</SelectItem>
                      <SelectItem value="attraction">Top attractions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editing.status ?? 'publish'} onValueChange={(value) => setEditing({ ...editing, status: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="publish">Published</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Subtitle</Label>
                  <Input value={editing.subtitle ?? ''} onChange={(event) => setEditing({ ...editing, subtitle: event.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={2} value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Items</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing({ ...editing, items: [...(editing.items ?? []), { title: '', subtitle: '', image: '', link: '', order: 0 }] })}
                  >
                    <Plus className="size-4" /> Add item
                  </Button>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {(editing.items ?? []).map((item, index) => (
                    <div key={index} className="space-y-2 rounded-lg border p-2.5">
                      <div className="flex gap-2">
                        <Input value={item.title ?? ''} onChange={(event) => setItem(index, { title: event.target.value })} placeholder="Title" />
                        <Input value={item.subtitle ?? ''} onChange={(event) => setItem(index, { subtitle: event.target.value })} placeholder="Subtitle" />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing({ ...editing, items: (editing.items ?? []).filter((_, i) => i !== index) })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Input value={item.image ?? ''} onChange={(event) => setItem(index, { image: event.target.value })} placeholder="Image URL" />
                        <Input value={item.link ?? ''} onChange={(event) => setItem(index, { link: event.target.value })} placeholder="Link" />
                        <Input
                          type="number"
                          className="w-24"
                          value={item.order ?? 0}
                          onChange={(event) => setItem(index, { order: Number(event.target.value) })}
                          placeholder="Order"
                        />
                      </div>
                    </div>
                  ))}
                  {(editing.items ?? []).length === 0 && <p className="text-xs text-muted-foreground">No items yet.</p>}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !editing?.title}>
              {busy ? 'Saving…' : 'Save showcase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete showcase?"
        description={`“${deleteTarget?.title}” will be removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/showcases/${deleteTarget.id}`);
            toast.success('Showcase deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
