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

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description?: string;
  categoryType?: string;
  categoryPageLink?: string;
  topExperience?: boolean;
  topAttraction?: boolean;
  image?: string;
  order?: number;
  productCount?: number;
}

const empty: CategoryRow = {
  id: '',
  name: '',
  slug: '',
  parentId: null,
  description: '',
  categoryType: '',
  categoryPageLink: '',
  topExperience: false,
  topAttraction: false,
  image: '',
  order: 0,
};

export default function Categories() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryRow[]>('/admin/categories'), select: (result) => result.data });
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const data = query.data ?? [];

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, productCount, ...payload } = editing;
      if (id) await api.put(`/admin/categories/${id}`, payload);
      else await api.post('/admin/categories', payload);
      toast.success(id ? 'Category updated' : 'Category created');
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: ['product-filters'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories"
        description="Destinations, cities and attractions used to organise tours."
        actions={
          <Button onClick={() => setEditing({ ...empty })}>
            <Plus className="size-4" /> New category
          </Button>
        }
      />

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <LoadingRows rows={8} cols={7} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={7} label="No categories yet" />
            ) : (
              data.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {category.image && <img src={category.image} alt="" className="size-8 rounded object-cover" />}
                      <div>
                        <div className="font-medium">{category.name}</div>
                        {category.description && (
                          <div className="max-w-72 truncate text-xs text-muted-foreground">{category.description}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{category.slug}</TableCell>
                  <TableCell className="capitalize text-sm">{category.categoryType || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {data.find((entry) => entry.id === category.parentId)?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">{category.productCount ?? 0}</TableCell>
                  <TableCell className="space-x-1 text-xs">
                    {category.topExperience && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">Top experience</span>}
                    {category.topAttraction && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600">Top attraction</span>}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing({ ...category })}>
                          <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(category)}>
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
            <DialogTitle>{editing?.id ? 'Edit category' : 'New category'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ ...editing, name: event.target.value, slug: editing.slug || slugify(event.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug</Label>
                  <Input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select
                    value={editing.categoryType || 'none'}
                    onValueChange={(value) => setEditing({ ...editing, categoryType: value === 'none' ? '' : value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="country">Country</SelectItem>
                      <SelectItem value="city">City</SelectItem>
                      <SelectItem value="attraction">Attraction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Parent</Label>
                  <Select
                    value={editing.parentId ?? 'none'}
                    onValueChange={(value) => setEditing({ ...editing, parentId: value === 'none' ? null : value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {data
                        .filter((category) => category.id !== editing.id)
                        .map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Image URL</Label>
                  <Input value={editing.image ?? ''} onChange={(event) => setEditing({ ...editing, image: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Page link</Label>
                  <Input
                    value={editing.categoryPageLink ?? ''}
                    onChange={(event) => setEditing({ ...editing, categoryPageLink: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Order</Label>
                  <Input
                    type="number"
                    value={editing.order ?? 0}
                    onChange={(event) => setEditing({ ...editing, order: Number(event.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={3} value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
              </div>
              <div className="flex gap-5">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={Boolean(editing.topExperience)}
                    onCheckedChange={(value) => setEditing({ ...editing, topExperience: value })}
                  />
                  Top experience
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={Boolean(editing.topAttraction)}
                    onCheckedChange={(value) => setEditing({ ...editing, topAttraction: value })}
                  />
                  Top attraction
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !editing?.name}>
              {busy ? 'Saving…' : 'Save category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete category?"
        description={`“${deleteTarget?.name}” will be removed and detached from products.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/categories/${deleteTarget.id}`);
            toast.success('Category deleted');
            void queryClient.invalidateQueries({ queryKey: ['categories'] });
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
