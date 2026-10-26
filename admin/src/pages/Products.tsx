import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminList, useDebounced } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader, Pagination, SearchInput, StatusBadge } from '@/components/shared/ui-bits';

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  sku?: string;
  status: string;
  price: number;
  currency: string;
  image: string;
  isFeatured: boolean;
  rating: { average: number; count: number };
  bookingCount: number;
  createdAt: string;
}

export default function Products() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('any');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const debounced = useDebounced(search);

  const { data, meta, loading, error } = useAdminList<ProductRow>(['products'], '/admin/products', {
    search: debounced || undefined,
    status,
    sort,
    page,
    limit: 20,
  });

  async function update(product: ProductRow, patch: Record<string, unknown>, message: string) {
    try {
      await api.put(`/admin/products/${product.id}`, patch);
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function duplicate(product: ProductRow) {
    try {
      const detail = (await api.get<Record<string, unknown>>(`/admin/products/${product.id}`)).data;
      const copy = { ...detail, id: undefined, title: `${detail.title} (copy)`, slug: undefined } as Record<string, unknown>;
      delete copy.id;
      delete copy._id;
      await api.post('/admin/products', copy);
      toast.success('Product duplicated');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Products"
        description="Tours, tickets and experiences for sale."
        actions={
          <Button asChild>
            <Link to="/products/new">
              <Plus className="size-4" /> New product
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search title, SKU…"
          className="w-full sm:w-72"
        />
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
        <Select value={sort} onValueChange={(value) => { setSort(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="title">Title A–Z</SelectItem>
            <SelectItem value="price-asc">Price: low to high</SelectItem>
            <SelectItem value="price-desc">Price: high to low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Bookings</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows rows={8} cols={7} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={7} label="No products yet" />
            ) : (
              data.map((product) => (
                <TableRow key={product.id} className="cursor-pointer" onClick={() => navigate(`/products/${product.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {product.image ? (
                        <img src={product.image} alt="" className="size-11 rounded-lg object-cover" />
                      ) : (
                        <div className="size-11 rounded-lg bg-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className="max-w-72 truncate">{product.title}</span>
                          {product.isFeatured && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                        </div>
                        <div className="text-xs text-muted-foreground">{product.sku || product.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={product.status} />
                  </TableCell>
                  <TableCell className="font-medium">{money(product.price, product.currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      {product.rating.average?.toFixed(1) ?? '0.0'}
                      <span className="text-xs text-muted-foreground">({product.rating.count ?? 0})</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{product.bookingCount ?? 0}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{date(product.createdAt)}</TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/products/${product.id}`)}>
                          <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicate(product)}>
                          <Copy className="size-4" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => update(product, { isFeatured: !product.isFeatured }, product.isFeatured ? 'Unfeatured' : 'Featured')}>
                          <Star className="size-4" /> {product.isFeatured ? 'Unfeature' : 'Feature'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            update(product, { status: product.status === 'publish' ? 'draft' : 'publish' }, product.status === 'publish' ? 'Moved to draft' : 'Published')
                          }
                        >
                          <Badge variant="outline" className="border-0 px-0">
                            {product.status === 'publish' ? 'Unpublish' : 'Publish'}
                          </Badge>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(product)}>
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
      <Pagination meta={meta} onPage={setPage} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete product?"
        description={`“${deleteTarget?.title}” will be permanently removed. Existing orders keep their snapshot.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/products/${deleteTarget.id}`);
            toast.success('Product deleted');
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </div>
  );
}
