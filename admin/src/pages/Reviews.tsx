import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ShieldX, Star, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminList, useDebounced } from '@/lib/hooks';
import { date } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader, Pagination, SearchInput } from '@/components/shared/ui-bits';

interface ReviewRow {
  id: string;
  authorName: string;
  authorEmail?: string;
  rating: number;
  title?: string;
  content: string;
  status: 'approved' | 'pending' | 'spam' | 'rejected';
  source: string;
  verifiedBooking: boolean;
  productTitle: string;
  productId: string;
  helpful?: number;
  createdAt: string;
}

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  approved: 'default',
  pending: 'secondary',
  spam: 'destructive',
  rejected: 'outline',
};

export default function Reviews() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('any');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<ReviewRow | null>(null);
  const debounced = useDebounced(search);

  const { data, meta, loading, error } = useAdminList<ReviewRow>(['reviews'], '/admin/reviews', {
    search: debounced || undefined,
    status,
    page,
    limit: 20,
  });

  async function setReviewStatus(review: ReviewRow, next: ReviewRow['status']) {
    try {
      await api.patch(`/admin/reviews/${review.id}`, { status: next });
      toast.success(`Review ${next}`);
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reviews" description="Moderate customer feedback and keep ratings honest." />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search author or content…"
          className="w-full sm:w-72"
        />
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="spam">Spam</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
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
                <EmptyRow colSpan={1} label="No reviews found" />
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map((review) => (
            <Card key={review.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{review.authorName}</span>
                      <span className="flex items-center gap-0.5 text-amber-500">
                        {Array.from({ length: review.rating }).map((_, index) => (
                          <Star key={index} className="size-3.5 fill-current" />
                        ))}
                      </span>
                      <Badge variant={statusVariant[review.status]} className="capitalize">
                        {review.status}
                      </Badge>
                      {review.verifiedBooking && <Badge variant="outline">Verified</Badge>}
                      <span className="text-xs text-muted-foreground">{review.source}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {review.productTitle} · {date(review.createdAt, true)}
                      {review.authorEmail ? ` · ${review.authorEmail}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {review.status !== 'approved' && (
                      <Button variant="outline" size="icon-sm" title="Approve" onClick={() => setReviewStatus(review, 'approved')}>
                        <Check className="size-4 text-emerald-600" />
                      </Button>
                    )}
                    {review.status !== 'spam' && (
                      <Button variant="outline" size="icon-sm" title="Mark spam" onClick={() => setReviewStatus(review, 'spam')}>
                        <ShieldX className="size-4 text-amber-600" />
                      </Button>
                    )}
                    {review.status !== 'rejected' && (
                      <Button variant="outline" size="icon-sm" title="Reject" onClick={() => setReviewStatus(review, 'rejected')}>
                        <X className="size-4" />
                      </Button>
                    )}
                    <Button variant="outline" size="icon-sm" title="Delete" onClick={() => setDeleteTarget(review)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {review.title && <p className="text-sm font-medium">{review.title}</p>}
                <p className="text-sm text-muted-foreground">{review.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Pagination meta={meta} onPage={setPage} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete review?"
        description="The product rating will be recalculated."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/reviews/${deleteTarget.id}`);
            toast.success('Review deleted');
            void queryClient.invalidateQueries({ queryKey: ['reviews'] });
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
