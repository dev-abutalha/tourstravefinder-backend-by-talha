import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAdminList } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyRow, LoadingRows, PageHeader, Pagination, StatCard } from '@/components/shared/ui-bits';

interface FraudSettings {
  enabled: boolean;
  reviewThreshold: number;
  blockThreshold: number;
  velocityWindowMinutes: number;
  maxIpAttempts: number;
  maxFingerprintAttempts: number;
  maxEmailAttempts: number;
  duplicateWindowMinutes: number;
  duplicateProductLimit: number;
  blockedIps: string[];
  blockedEmails: string[];
  blockedFingerprints: string[];
  blockedDomains: string[];
  disposableDomains: string[];
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  turnstileMode: 'off' | 'managed' | 'invisible';
  fpjsPublicApiKey: string;
  fpjsRegion: string;
}

interface FraudOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerEmail: string;
  total: number;
  fraud: { level?: string; score?: number; reasons?: string[]; reviewed?: boolean };
  createdAt: string;
}

interface FraudEventRow {
  id: string;
  eventType: string;
  orderId?: string;
  status: string;
  riskScore: number;
  reasons?: string[];
  createdAt: string;
}

const levels: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  allowed: 'outline',
  review: 'secondary',
  blocked: 'destructive',
};

export default function Fraud() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('orders');
  const [settings, setSettings] = useState<FraudSettings | null>(null);
  const [level, setLevel] = useState('any');
  const [page, setPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [blockType, setBlockType] = useState('ip');
  const [blockValue, setBlockValue] = useState('');

  const settingsQuery = useQuery({ queryKey: ['fraud-settings'], queryFn: () => api.get<FraudSettings>('/admin/fraud/settings'), select: (result) => result.data });
  const orders = useAdminList<FraudOrder>(['fraud-orders', level], '/admin/fraud/orders', { level, page, limit: 25 });
  const events = useAdminList<FraudEventRow>(['fraud-events'], '/admin/fraud/events', { page: eventPage, limit: 25 });

  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data);
  }, [settingsQuery.data]);

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    try {
      await api.put('/admin/fraud/settings', settings);
      toast.success('Fraud settings saved');
      void queryClient.invalidateQueries({ queryKey: ['fraud-settings'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addBlocklist() {
    if (!blockValue) return;
    setBusy(true);
    try {
      await api.post('/admin/fraud/blocklist', { type: blockType, value: blockValue, action: 'add' });
      toast.success('Added to blocklist');
      setBlockValue('');
      void queryClient.invalidateQueries({ queryKey: ['fraud-settings'] });
      setSettings((await api.get<FraudSettings>('/admin/fraud/settings')).data);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function setOrderLevel(order: FraudOrder, next: 'allowed' | 'review' | 'blocked') {
    try {
      await api.patch(`/admin/fraud/orders/${order.id}`, { level: next, reviewed: true });
      toast.success(`Order marked ${next}`);
      void queryClient.invalidateQueries({ queryKey: ['fraud-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['fraud-events'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function rescan() {
    setBusy(true);
    try {
      const result = await api.post<{ scanned?: number; flagged?: number }>('/admin/fraud/rescan', { onlyRisky: false });
      toast.success(`Rescanned ${result.data.scanned ?? 0} orders, flagged ${result.data.flagged ?? 0}`);
      void queryClient.invalidateQueries({ queryKey: ['fraud-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['fraud-events'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const flagged = orders.data.filter((order) => order.fraud.level === 'review' || order.fraud.level === 'blocked').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fraud shield"
        description="Risk scoring, blocklists and manual review queue."
        actions={
          <Button variant="outline" onClick={rescan} disabled={busy}>
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /> Rescan orders
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Review queue" value={String(flagged)} icon={<ShieldAlert className="size-4" />} />
        <StatCard label="Blocked IPs" value={String(settings?.blockedIps.length ?? 0)} icon={<ShieldX className="size-4" />} />
        <StatCard label="Blocked emails" value={String(settings?.blockedEmails.length ?? 0)} icon={<ShieldCheck className="size-4" />} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="events">Audit log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-3">
          <Select value={level} onValueChange={(value) => { setLevel(value); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">All levels</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="allowed">Allowed</SelectItem>
            </SelectContent>
          </Select>
          <div className="rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Reasons</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.loading ? (
                  <LoadingRows rows={6} cols={6} />
                ) : orders.data.length === 0 ? (
                  <EmptyRow colSpan={6} label="No risky orders" />
                ) : (
                  orders.data.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link to={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                          {order.orderNumber}
                        </Link>
                        <div className="text-xs text-muted-foreground">{date(order.createdAt, true)}</div>
                      </TableCell>
                      <TableCell className="text-sm">{order.customerEmail}</TableCell>
                      <TableCell className="text-sm">{money(order.total)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={levels[order.fraud.level ?? 'allowed']} className="capitalize">
                            {order.fraud.level ?? 'allowed'}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{order.fraud.score ?? 0}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-72">
                        <p className="truncate text-xs text-muted-foreground" title={(order.fraud.reasons ?? []).join(', ')}>
                          {(order.fraud.reasons ?? []).join(', ') || '—'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => setOrderLevel(order, 'allowed')}>
                            Allow
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setOrderLevel(order, 'review')}>
                            Review
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setOrderLevel(order, 'blocked')}>
                            Block
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination meta={orders.meta} onPage={setPage} />
        </TabsContent>

        <TabsContent value="events">
          <div className="rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Reasons</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.loading ? (
                  <LoadingRows rows={6} cols={5} />
                ) : events.data.length === 0 ? (
                  <EmptyRow colSpan={5} label="No fraud events recorded" />
                ) : (
                  events.data.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.eventType}</TableCell>
                      <TableCell>
                        <Badge variant={levels[event.status] ?? 'outline'} className="capitalize">
                          {event.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{event.riskScore}</TableCell>
                      <TableCell className="max-w-96 truncate text-xs text-muted-foreground">
                        {(event.reasons ?? []).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{date(event.createdAt, true)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3">
            <Pagination meta={events.meta} onPage={setEventPage} />
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {!settings ? (
            <LoadingRows rows={6} cols={3} />
          ) : (
            <>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Scoring</CardTitle>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={settings.enabled} onCheckedChange={(value) => setSettings({ ...settings, enabled: value })} />
                    {settings.enabled ? 'Enabled' : 'Disabled'}
                  </label>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  {[
                    ['reviewThreshold', 'Review threshold'],
                    ['blockThreshold', 'Block threshold'],
                    ['velocityWindowMinutes', 'Velocity window (min)'],
                    ['maxIpAttempts', 'Max IP attempts'],
                    ['maxFingerprintAttempts', 'Max fingerprint attempts'],
                    ['maxEmailAttempts', 'Max email attempts'],
                    ['duplicateWindowMinutes', 'Duplicate window (min)'],
                    ['duplicateProductLimit', 'Duplicate product limit'],
                  ].map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label>{label}</Label>
                      <Input
                        type="number"
                        value={String(settings[key as keyof FraudSettings] ?? 0)}
                        onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Turnstile & FingerprintJS</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Turnstile mode</Label>
                    <Select value={settings.turnstileMode} onValueChange={(value) => setSettings({ ...settings, turnstileMode: value as FraudSettings['turnstileMode'] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="managed">Managed</SelectItem>
                        <SelectItem value="invisible">Invisible</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Turnstile site key</Label>
                    <Input value={settings.turnstileSiteKey} onChange={(event) => setSettings({ ...settings, turnstileSiteKey: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Turnstile secret</Label>
                    <Input type="password" value={settings.turnstileSecretKey} onChange={(event) => setSettings({ ...settings, turnstileSecretKey: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>FingerprintJS public key</Label>
                    <Input value={settings.fpjsPublicApiKey} onChange={(event) => setSettings({ ...settings, fpjsPublicApiKey: event.target.value })} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Blocklists</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <Select value={blockType} onValueChange={setBlockType}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ip">IP</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="fingerprint">Fingerprint</SelectItem>
                          <SelectItem value="domain">Domain</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-56 flex-1 space-y-1.5">
                      <Label>Value</Label>
                      <Input value={blockValue} onChange={(event) => setBlockValue(event.target.value)} placeholder="e.g. 203.0.113.5" />
                    </div>
                    <Button onClick={addBlocklist} disabled={busy || !blockValue}>
                      Add
                    </Button>
                  </div>
                  {[
                    ['blockedIps', 'IPs'],
                    ['blockedEmails', 'Emails'],
                    ['blockedFingerprints', 'Fingerprints'],
                    ['blockedDomains', 'Domains'],
                  ].map(([key, label]) => {
                    const list = settings[key as keyof FraudSettings] as string[];
                    return (
                      <div key={key}>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {label} ({list.length})
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {list.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                          {list.map((entry) => (
                            <Badge key={entry} variant="secondary" className="font-mono text-[11px]">
                              {entry}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={saveSettings} disabled={busy}>
                  {busy ? 'Saving…' : 'Save settings'}
                </Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
