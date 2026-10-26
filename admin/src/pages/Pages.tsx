import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { date } from '@/lib/format';
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

interface PageRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  template?: string;
  excerpt?: string;
  content?: string;
  image?: string;
  updatedAt?: string;
}

const empty: PageRow = { id: '', title: '', slug: '', status: 'publish', template: 'default', content: '', excerpt: '', image: '' };

const templates = ['default', 'home', 'about-us', 'contact-us', 'faq', 'destinations', 'attractions', 'order-tracker', 'terms', 'privacy'];

export default function Pages() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['pages'], queryFn: () => api.get<PageRow[]>('/admin/pages'), select: (result) => result.data });
  const [editing, setEditing] = useState<PageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PageRow | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['pages'] });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, updatedAt, ...payload } = editing;
      if (id) await api.put(`/admin/pages/${id}`, payload);
      else await api.post('/admin/pages', payload);
      toast.success(id ? 'Page saved' : 'Page created');
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
        title="Pages"
        description="Static pages including the homepage and templates."
        actions={
          <Button onClick={() => setEditing({ ...empty })}>
            <Plus className="size-4" /> New page
          </Button>
        }
      />

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <LoadingRows rows={6} cols={6} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={6} label="No pages yet" />
            ) : (
              data.map((page) => (
                <TableRow key={page.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <FileText className="size-4 text-muted-foreground" />
                      {page.title}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">/{page.slug}</TableCell>
                  <TableCell className="text-sm capitalize">{page.template || 'default'}</TableCell>
                  <TableCell>
                    <Badge variant={page.status === 'publish' ? 'default' : 'secondary'} className="capitalize">
                      {page.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{page.updatedAt ? date(page.updatedAt) : '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ ...page })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(page)}>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit page' : 'New page'}</DialogTitle>
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
                  <Label>Template</Label>
                  <Select value={editing.template ?? 'default'} onValueChange={(value) => setEditing({ ...editing, template: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template} value={template} className="capitalize">
                          {template}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      <SelectItem value="private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Excerpt</Label>
                <Textarea rows={2} value={editing.excerpt ?? ''} onChange={(event) => setEditing({ ...editing, excerpt: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Featured image URL</Label>
                <Input value={editing.image ?? ''} onChange={(event) => setEditing({ ...editing, image: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Content (HTML)</Label>
                <Textarea rows={12} className="font-mono text-xs" value={editing.content ?? ''} onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !editing?.title}>
              {busy ? 'Saving…' : 'Save page'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete page?"
        description={`“${deleteTarget?.title}” will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/pages/${deleteTarget.id}`);
            toast.success('Page deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
