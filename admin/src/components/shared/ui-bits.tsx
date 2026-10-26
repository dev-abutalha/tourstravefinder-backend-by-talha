import * as React from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { titleCase } from '@/lib/format';
import type { PageMeta } from '@/lib/api';

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}

export function LoadingRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row} className="border-b">
          {Array.from({ length: cols }).map((__, col) => (
            <td key={col} className="px-3 py-3">
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyRow({ colSpan, label = 'Nothing found' }: { colSpan: number; label?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-16 text-center text-sm text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}

export function Pagination({
  meta,
  onPage,
}: {
  meta?: PageMeta;
  onPage: (page: number) => void;
}) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
      <span>
        Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} total
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

const statusVariants: Record<string, 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'info'> = {
  publish: 'success',
  completed: 'success',
  approved: 'success',
  'booking-confirm': 'success',
  active: 'success',
  draft: 'secondary',
  pending: 'warning',
  processing: 'warning',
  'on-hold': 'warning',
  'fraud-review': 'destructive',
  cancelled: 'destructive',
  failed: 'destructive',
  rejected: 'destructive',
  spam: 'destructive',
  refunded: 'info',
  private: 'outline',
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const value = status ?? 'unknown';
  return (
    <Badge variant={statusVariants[value] ?? 'outline'} className={className}>
      {titleCase(value)}
    </Badge>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span className="text-sm font-medium">
          {label} {required && <span className="text-destructive">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-5 shadow-sm', accent && 'border-primary/30')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <span className={cn('flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground', accent && 'bg-primary/10 text-primary')}>
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
