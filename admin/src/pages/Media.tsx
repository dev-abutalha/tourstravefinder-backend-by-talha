import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader, SearchInput } from '@/components/shared/ui-bits';

interface MediaRow {
  id: string;
  filename: string;
  originalName?: string;
  mimeType: string;
  size: number;
  url: string;
  alt?: string;
  isSecure: boolean;
  createdAt: string;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function Media() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['media'], queryFn: () => api.get<MediaRow[]>('/admin/media'), select: (result) => result.data });
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [alt, setAlt] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MediaRow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const data = (query.data ?? []).filter((item) =>
    `${item.filename} ${item.originalName ?? ''} ${item.alt ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await api.post('/admin/media', { filename: file.name, content, alt });
      }
      toast.success(`${files.length} file(s) uploaded`);
      setAlt('');
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['media'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Media"
        description="Public images and documents served from /media."
        actions={
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            <Upload className="size-4" /> {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        }
      />

      <input ref={fileInput} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(event) => upload(event.target.files)} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search media…" className="w-full sm:w-72" />
        <Input value={alt} onChange={(event) => setAlt(event.target.value)} placeholder="Alt text for next upload" className="w-full sm:w-72" />
      </div>

      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ImageIcon className="size-8" />
            <p className="text-sm">No media yet. Upload your first image.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.map((item) => (
            <div key={item.id} className="group overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="relative aspect-square bg-muted">
                {item.mimeType.startsWith('image/') ? (
                  <img src={item.url} alt={item.alt ?? ''} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-8" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(item.url);
                      toast.success('URL copied');
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button variant="destructive" size="icon-sm" onClick={() => setDeleteTarget(item)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium" title={item.filename}>
                  {item.originalName || item.filename}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatBytes(item.size)} · {date(item.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete file?"
        description={`${deleteTarget?.filename} will be removed from disk.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/media/${deleteTarget.id}`);
            toast.success('File deleted');
            void queryClient.invalidateQueries({ queryKey: ['media'] });
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
