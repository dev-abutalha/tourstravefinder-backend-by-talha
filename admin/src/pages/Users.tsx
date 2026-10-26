import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Pencil, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminList, useDebounced } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyRow, LoadingRows, PageHeader, Pagination, SearchInput } from '@/components/shared/ui-bits';

interface UserRow {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  role: 'customer' | 'manager' | 'admin';
  isActive: boolean;
  emailVerified: boolean;
  orderCount: number;
  totalSpent: number;
  createdAt: string;
}

export default function Users() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('any');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  const { data, meta, loading, error } = useAdminList<UserRow>(['users'], '/admin/users', {
    search: debounced || undefined,
    role,
    page,
    limit: 25,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await api.patch(`/admin/users/${editing.id}`, {
        firstName: editing.firstName,
        lastName: editing.lastName,
        phone: editing.phone,
        role: editing.role,
        isActive: editing.isActive,
        emailVerified: editing.emailVerified,
      });
      toast.success('User updated');
      setEditing(null);
      invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!passwordTarget) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${passwordTarget.id}/password`, { password: newPassword });
      toast.success('Password updated');
      setPasswordTarget(null);
      setNewPassword('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Customers and team members with access to the admin panel."
        actions={
          <Button variant="outline" disabled>
            <UserPlus className="size-4" /> Invite user
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
          placeholder="Search name or email…"
          className="w-full sm:w-72"
        />
        <Select value={role} onValueChange={(value) => { setRole(value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All roles</SelectItem>
            <SelectItem value="customer">Customers</SelectItem>
            <SelectItem value="manager">Managers</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}

      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Orders</TableHead>
              <TableHead>Spent</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows rows={7} cols={7} />
            ) : data.length === 0 ? (
              <EmptyRow colSpan={7} label="No users found" />
            ) : (
              data.map((user) => {
                const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || 'Guest';
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8">
                          <AvatarFallback className="text-xs">
                            {(user.firstName?.[0] ?? user.email[0] ?? '?').toUpperCase()}
                            {(user.lastName?.[0] ?? '').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'admin' ? 'default' : user.role === 'manager' ? 'secondary' : 'outline'} className="capitalize">
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{user.orderCount}</TableCell>
                    <TableCell className="text-sm">{money(user.totalSpent)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{date(user.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={user.isActive ? 'outline' : 'destructive'} className="text-[10px]">
                          {user.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                        {!user.emailVerified && (
                          <Badge variant="secondary" className="text-[10px]">
                            Unverified
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing({ ...user })}>
                            <Pencil className="size-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPasswordTarget(user)}>
                            <KeyRound className="size-4" /> Set password
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(user)}>
                            <Trash2 className="size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination meta={meta} onPage={setPage} />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>First name</Label>
                  <Input value={editing.firstName ?? ''} onChange={(event) => setEditing({ ...editing, firstName: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Last name</Label>
                  <Input value={editing.lastName ?? ''} onChange={(event) => setEditing({ ...editing, lastName: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={editing.phone ?? ''} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={editing.role} onValueChange={(value) => setEditing({ ...editing, role: value as UserRow['role'] })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Customer</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center justify-between text-sm">
                Account active
                <Switch checked={editing.isActive} onCheckedChange={(value) => setEditing({ ...editing, isActive: value })} />
              </label>
              <label className="flex items-center justify-between text-sm">
                Email verified
                <Switch checked={editing.emailVerified} onCheckedChange={(value) => setEditing({ ...editing, emailVerified: value })} />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordTarget !== null} onOpenChange={(open) => !open && setPasswordTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{passwordTarget?.email}</p>
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordTarget(null)}>
              Cancel
            </Button>
            <Button onClick={resetPassword} disabled={busy || newPassword.length < 8}>
              Update password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete user?"
        description={`${deleteTarget?.email} will lose access. Orders stay intact.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.delete(`/admin/users/${deleteTarget.id}`);
            toast.success('User deleted');
            invalidate();
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
