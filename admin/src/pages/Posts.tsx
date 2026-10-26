import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminList, useDebounced } from '@/lib/hooks';
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
import { EmptyRow, LoadingRows, PageHeader, Pagination, SearchInput } from '@/components/shared/ui-bits';

interface PostRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  excerpt?: string;
  content?: string;
  authorName?: string;
  image?: string;
  createdAt: string;
}

const empty: PostRow = { id: '', title: '', slug: '', status: 'draft', excerpt: '', content: '', authorName: '', image: '', createdAt: '' };

export default function Posts() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('any');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PostRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostRow | null>(null);
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  const { data, meta, loading, error } = useAdminList<PostRow>(['posts'], '/admin/posts', {
    search: debounced || undefined,
    status,
    page,
    limit: 20,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['posts'] });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, createdAt, ...payload } = editing;
      if (id) await api.put(`/admin/posts/${id}`, payload);
      else await api.post('/admin/posts', payload);
      toast.success(id ? 'Post saved' : 'Post created');
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
        title="Blog posts"
        description="Travel guides, inspiration and news."
        actions={
          <Button onClick={() => setEditing({ ...empty })}>
            <Plus className="size-4" /> New post
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search posts…" className="w-full sm:w-72" />
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All statuses</SelectItem>
            <SelectItem value="publish">Published</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Post</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows rows={6} cols={5} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={5} label="No posts yet" />
            ) : (
              data.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {post.image && <img src={post.image} alt="" className="size-10 rounded object-cover" />}
                      <div>
                        <div className="font-medium">{post.title}</div>
                        <div className="max-w-80 truncate text-xs text-muted-foreground">/{post.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{post.authorName || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={post.status === 'publish' ? 'default' : 'secondary'} className="capitalize">
                      {post.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{date(post.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ ...post })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(post)}>
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
      <Pagination meta={meta} onPage={setPage} />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit post' : 'New post'}</DialogTitle>
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
                  <Label>Author</Label>
                  <Input value={editing.authorName ?? ''} onChange={(event) => setEditing({ ...editing, authorName: event.target.value })} />
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
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Featured image URL</Label>
                <Input value={editing.image ?? ''} onChange={(event) => setEditing({ ...editing, image: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Excerpt</Label>
                <Textarea rows={2} value={editing.excerpt ?? ''} onChange={(event) => setEditing({ ...editing, excerpt: event.target.value })} />
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
              {busy ? 'Saving…' : 'Save post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete post?"
        description={`“${deleteTarget?.title}” will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/posts/${deleteTarget.id}`);
            toast.success('Post deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
