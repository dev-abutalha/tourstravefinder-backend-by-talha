import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { slugify } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader } from '@/components/shared/ui-bits';

interface Term {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  order?: number;
}

const kinds = [
  ['product_tag', 'Tags'],
  ['activity_type', 'Activity types'],
];

export default function Taxonomies() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('product_tag');
  const [editing, setEditing] = useState<Term | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Term | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({ queryKey: ['taxonomies', kind], queryFn: () => api.get<Term[]>(`/admin/taxonomies/${kind}`), select: (result) => result.data });
  const data = query.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['taxonomies', kind] });
    void queryClient.invalidateQueries({ queryKey: ['product-filters'] });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const payload = { name: editing.name, slug: editing.slug, description: editing.description, image: editing.image, order: editing.order };
      if (editing.id) await api.put(`/admin/taxonomies/${kind}/${editing.id}`, payload);
      else await api.post(`/admin/taxonomies/${kind}`, payload);
      toast.success(editing.id ? 'Term updated' : 'Term created');
      setEditing(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Taxonomies"
        description="Tags and activity types used across products."
        actions={
          <Button onClick={() => setEditing({ id: '', name: '', slug: '' })}>
            <Plus className="size-4" /> New term
          </Button>
        }
      />

      <Tabs value={kind} onValueChange={setKind}>
        <TabsList>
          {kinds.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <LoadingRows rows={6} cols={5} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={5} label="No terms yet" />
            ) : (
              data.map((term) => (
                <TableRow key={term.id}>
                  <TableCell className="font-medium">{term.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{term.slug}</TableCell>
                  <TableCell className="max-w-96 truncate text-sm text-muted-foreground">{term.description || '—'}</TableCell>
                  <TableCell className="text-sm">{term.order ?? 0}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing({ ...term })}>
                          <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(term)}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit term' : 'New term'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value, slug: editing.slug || slugify(event.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={3} value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Image URL</Label>
                <Input value={editing.image ?? ''} onChange={(event) => setEditing({ ...editing, image: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Order</Label>
                <Input type="number" value={editing.order ?? 0} onChange={(event) => setEditing({ ...editing, order: Number(event.target.value) })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !editing?.name}>
              {busy ? 'Saving…' : 'Save term'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete term?"
        description={`“${deleteTarget?.name}” will be removed from products.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/taxonomies/${kind}/${deleteTarget.id}`);
            toast.success('Term deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
