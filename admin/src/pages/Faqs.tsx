import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader } from '@/components/shared/ui-bits';

interface FaqRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  content?: string;
  excerpt?: string;
  categoryIds?: string[];
  order?: number;
}

interface FaqCategoryRow {
  id: string;
  name: string;
  slug: string;
  description?: string;
  order?: number;
}

export default function Faqs() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('faqs');
  const [editing, setEditing] = useState<FaqRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FaqRow | null>(null);
  const [editingCategory, setEditingCategory] = useState<FaqCategoryRow | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<FaqCategoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const faqs = useQuery({ queryKey: ['faqs'], queryFn: () => api.get<FaqRow[]>('/admin/faqs'), select: (result) => result.data });
  const categories = useQuery({ queryKey: ['faq-categories'], queryFn: () => api.get<FaqCategoryRow[]>('/admin/faq-categories'), select: (result) => result.data });

  useEffect(() => {
    if (!editing && faqs.data?.length && tab === 'faqs') {
      /* nothing – keeps dialog closed */
    }
  }, [editing, faqs.data, tab]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['faqs'] });
    void queryClient.invalidateQueries({ queryKey: ['faq-categories'] });
  }

  async function saveFaq() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...payload } = editing;
      if (id) await api.put(`/admin/faqs/${id}`, payload);
      else await api.post('/admin/faqs', payload);
      toast.success(id ? 'FAQ saved' : 'FAQ created');
      setEditing(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory() {
    if (!editingCategory) return;
    setBusy(true);
    try {
      const { id, ...payload } = editingCategory;
      if (id) await api.put(`/admin/faq-categories/${id}`, payload);
      else await api.post('/admin/faq-categories', payload);
      toast.success(id ? 'Category saved' : 'Category created');
      setEditingCategory(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const faqData = faqs.data ?? [];
  const categoryData = categories.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="FAQs" description="Answers to common questions, grouped by topic." />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="faqs">Questions</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="faqs" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditing({ id: '', title: '', slug: '', status: 'publish', content: '', excerpt: '', categoryIds: [], order: 0 })}>
              <Plus className="size-4" /> New FAQ
            </Button>
          </div>
          <div className="rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {faqs.isLoading ? (
                  <LoadingRows rows={6} cols={5} />
                ) : faqData.length === 0 ? (
                  <EmptyRow colSpan={5} label="No FAQs yet" />
                ) : (
                  faqData.map((faq) => (
                    <TableRow key={faq.id}>
                      <TableCell>
                        <div className="max-w-96 truncate font-medium">{faq.title}</div>
                        {faq.excerpt && <div className="max-w-96 truncate text-xs text-muted-foreground">{faq.excerpt}</div>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(faq.categoryIds ?? []).map((id) => categoryData.find((category) => category.id === id)?.name).filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={faq.status === 'publish' ? 'default' : 'secondary'} className="capitalize">
                          {faq.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{faq.order ?? 0}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ ...faq })}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(faq)}>
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
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditingCategory({ id: '', name: '', slug: '', description: '', order: 0 })}>
              <Plus className="size-4" /> New category
            </Button>
          </div>
          <div className="rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.isLoading ? (
                  <LoadingRows rows={5} cols={5} />
                ) : categoryData.length === 0 ? (
                  <EmptyRow colSpan={5} label="No FAQ categories yet" />
                ) : (
                  categoryData.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell className="font-medium">{category.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{category.slug}</TableCell>
                      <TableCell className="max-w-96 truncate text-sm text-muted-foreground">{category.description || '—'}</TableCell>
                      <TableCell className="text-sm">{category.order ?? 0}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditingCategory({ ...category })}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleteCategory(category)}>
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
        </TabsContent>
      </Tabs>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit FAQ' : 'New FAQ'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Question</Label>
                <Input
                  value={editing.title}
                  onChange={(event) => setEditing({ ...editing, title: event.target.value, slug: editing.slug || slugify(event.target.value) })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Slug</Label>
                  <Input value={editing.slug} onChange={(event) => setEditing({ ...editing, slug: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editing.status} onValueChange={(value) => setEditing({ ...editing, status: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="publish">Published</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Categories</Label>
                <div className="flex flex-wrap gap-1.5">
                  {categoryData.map((category) => {
                    const checked = (editing.categoryIds ?? []).includes(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            categoryIds: checked
                              ? (editing.categoryIds ?? []).filter((id) => id !== category.id)
                              : [...(editing.categoryIds ?? []), category.id],
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${checked ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                  {categoryData.length === 0 && <p className="text-xs text-muted-foreground">Create a category first.</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Excerpt</Label>
                <Textarea rows={2} value={editing.excerpt ?? ''} onChange={(event) => setEditing({ ...editing, excerpt: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Answer (HTML)</Label>
                <Textarea rows={8} className="font-mono text-xs" value={editing.content ?? ''} onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
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
            <Button onClick={saveFaq} disabled={busy || !editing?.title}>
              {busy ? 'Saving…' : 'Save FAQ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingCategory !== null} onOpenChange={(open) => !open && setEditingCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory?.id ? 'Edit category' : 'New category'}</DialogTitle>
          </DialogHeader>
          {editingCategory && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editingCategory.name}
                  onChange={(event) =>
                    setEditingCategory({ ...editingCategory, name: event.target.value, slug: editingCategory.slug || slugify(event.target.value) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={editingCategory.slug} onChange={(event) => setEditingCategory({ ...editingCategory, slug: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={2} value={editingCategory.description ?? ''} onChange={(event) => setEditingCategory({ ...editingCategory, description: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Order</Label>
                <Input type="number" value={editingCategory.order ?? 0} onChange={(event) => setEditingCategory({ ...editingCategory, order: Number(event.target.value) })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCategory(null)}>
              Cancel
            </Button>
            <Button onClick={saveCategory} disabled={busy || !editingCategory?.name}>
              {busy ? 'Saving…' : 'Save category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete FAQ?"
        description={`“${deleteTarget?.title}” will be removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/faqs/${deleteTarget.id}`);
            toast.success('FAQ deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />

      <ConfirmDialog
        open={deleteCategory !== null}
        onOpenChange={(open) => !open && setDeleteCategory(null)}
        title="Delete category?"
        description={`“${deleteCategory?.name}” will be removed from related FAQs.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteCategory) return;
          try {
            await api.delete(`/admin/faq-categories/${deleteCategory.id}`);
            toast.success('Category deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
