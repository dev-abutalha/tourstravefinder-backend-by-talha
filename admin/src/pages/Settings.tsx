import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/ui-bits';

interface Social {
  label: string;
  url: string;
  icon?: string;
}
interface SiteSettings {
  siteName: string;
  siteUrl: string;
  supportEmail: string;
  adminEmail: string;
  currency: string;
  currencySymbol: string;
  mailFromName: string;
  mailFromAddress: string;
  phoneCountries?: string;
  socials: Social[];
  analytics: { gaId?: string; gtmId?: string; facebookPixel?: string; metaPixel?: string };
  seo: { title: string; description: string; ogImage: string };
  booking: { reservationMinutes: number; freeCancellationHours: number };
}
interface PromoSettings {
  showBanner: boolean;
  title: string;
  offerText: string;
  buttonText: string;
  buttonLink: string;
  bgImage: string;
  productType: 'category' | 'tag' | 'products';
  category: string[];
  tag: string[];
  productIds: string[];
}
interface FomoSettings {
  enabled: boolean;
  entries: { person: string; country: string; productIds: string[] }[];
}
interface CheckoutSettings {
  extras: { id: string; label: string; price: number }[];
  pickupOptions: string[];
  departureOptions: string[];
  requiresCompanyField: boolean;
  minTravelers: number;
  maxTravelers: number;
}

function listToText(list: string[] = []) {
  return list.join(', ');
}
function textToList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function Settings() {
  const queryClient = useQueryClient();
  const site = useQuery({ queryKey: ['settings-site'], queryFn: () => api.get<SiteSettings>('/admin/settings/site'), select: (result) => result.data });
  const promo = useQuery({ queryKey: ['settings-promo'], queryFn: () => api.get<PromoSettings>('/admin/settings/promo'), select: (result) => result.data });
  const fomo = useQuery({ queryKey: ['settings-fomo'], queryFn: () => api.get<FomoSettings>('/admin/settings/fomo'), select: (result) => result.data });
  const checkout = useQuery({ queryKey: ['settings-checkout'], queryFn: () => api.get<CheckoutSettings>('/admin/settings/checkout'), select: (result) => result.data });
  const cache = useQuery({ queryKey: ['settings-cache'], queryFn: () => api.get<Record<string, unknown>>('/admin/settings/cache'), select: (result) => result.data });

  const [siteForm, setSiteForm] = useState<SiteSettings | null>(null);
  const [promoForm, setPromoForm] = useState<PromoSettings | null>(null);
  const [fomoForm, setFomoForm] = useState<FomoSettings | null>(null);
  const [checkoutForm, setCheckoutForm] = useState<CheckoutSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (site.data) setSiteForm(site.data);
  }, [site.data]);
  useEffect(() => {
    if (promo.data) setPromoForm(promo.data);
  }, [promo.data]);
  useEffect(() => {
    if (fomo.data) setFomoForm(fomo.data);
  }, [fomo.data]);
  useEffect(() => {
    if (checkout.data) setCheckoutForm(checkout.data);
  }, [checkout.data]);

  async function save(path: string, body: unknown, key: string) {
    setBusy(true);
    try {
      await api.put(`/admin/settings/${path}`, body);
      toast.success('Settings saved');
      void queryClient.invalidateQueries({ queryKey: [key] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function flushCache() {
    setBusy(true);
    try {
      await api.post('/admin/settings/cache/flush', {});
      toast.success('Cache flushed');
      void queryClient.invalidateQueries({ queryKey: ['settings-cache'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Site identity, marketing, checkout and maintenance." />

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="promo">Promo banner</TabsTrigger>
          <TabsTrigger value="fomo">FOMO</TabsTrigger>
          <TabsTrigger value="checkout">Checkout</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          {!siteForm ? (
            <Skeleton className="h-96 rounded-xl" />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Site</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['siteName', 'Site name'],
                    ['siteUrl', 'Site URL'],
                    ['supportEmail', 'Support email'],
                    ['adminEmail', 'Admin email'],
                    ['currency', 'Currency code'],
                    ['currencySymbol', 'Currency symbol'],
                    ['mailFromName', 'Mail from name'],
                    ['mailFromAddress', 'Mail from address'],
                    ['phoneCountries', 'Phone country codes'],
                  ].map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label>{label}</Label>
                      <Input
                        value={String(siteForm[key as keyof SiteSettings] ?? '')}
                        onChange={(event) => setSiteForm({ ...siteForm, [key]: event.target.value })}
                      />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label>Reservation hold (minutes)</Label>
                    <Input
                      type="number"
                      value={siteForm.booking?.reservationMinutes ?? 30}
                      onChange={(event) =>
                        setSiteForm({ ...siteForm, booking: { ...siteForm.booking, reservationMinutes: Number(event.target.value) } })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Free cancellation window (hours)</Label>
                    <Input
                      type="number"
                      value={siteForm.booking?.freeCancellationHours ?? 24}
                      onChange={(event) =>
                        setSiteForm({ ...siteForm, booking: { ...siteForm.booking, freeCancellationHours: Number(event.target.value) } })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>SEO & analytics</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Default meta title</Label>
                    <Input value={siteForm.seo?.title ?? ''} onChange={(event) => setSiteForm({ ...siteForm, seo: { ...siteForm.seo, title: event.target.value } })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Default meta description</Label>
                    <Textarea rows={2} value={siteForm.seo?.description ?? ''} onChange={(event) => setSiteForm({ ...siteForm, seo: { ...siteForm.seo, description: event.target.value } })} />
                  </div>
                  {[
                    ['gaId', 'Google Analytics ID'],
                    ['gtmId', 'Google Tag Manager ID'],
                    ['metaPixel', 'Meta pixel ID'],
                    ['facebookPixel', 'Facebook pixel ID'],
                  ].map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label>{label}</Label>
                      <Input
                        value={String(siteForm.analytics?.[key as keyof SiteSettings['analytics']] ?? '')}
                        onChange={(event) => setSiteForm({ ...siteForm, analytics: { ...siteForm.analytics, [key]: event.target.value } })}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Social links</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSiteForm({ ...siteForm, socials: [...(siteForm.socials ?? []), { label: '', url: '' }] })}
                  >
                    <Plus className="size-4" /> Add
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(siteForm.socials ?? []).map((social, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={social.label}
                        placeholder="Label"
                        onChange={(event) =>
                          setSiteForm({
                            ...siteForm,
                            socials: siteForm.socials.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)),
                          })
                        }
                      />
                      <Input
                        value={social.url}
                        placeholder="https://…"
                        onChange={(event) =>
                          setSiteForm({
                            ...siteForm,
                            socials: siteForm.socials.map((entry, i) => (i === index ? { ...entry, url: event.target.value } : entry)),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSiteForm({ ...siteForm, socials: siteForm.socials.filter((_, i) => i !== index) })}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={() => save('site', siteForm, 'settings-site')} disabled={busy}>
                  <Save className="size-4" /> Save general
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="promo" className="space-y-4">
          {!promoForm ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : (
            <>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Promotional banner</CardTitle>
                  <Switch checked={promoForm.showBanner} onCheckedChange={(value) => setPromoForm({ ...promoForm, showBanner: value })} />
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['title', 'Title'],
                    ['offerText', 'Offer text'],
                    ['buttonText', 'Button text'],
                    ['buttonLink', 'Button link'],
                    ['bgImage', 'Background image URL'],
                  ].map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label>{label}</Label>
                      <Input value={String(promoForm[key as keyof PromoSettings] ?? '')} onChange={(event) => setPromoForm({ ...promoForm, [key]: event.target.value })} />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label>Category IDs</Label>
                    <Input value={listToText(promoForm.category)} onChange={(event) => setPromoForm({ ...promoForm, category: textToList(event.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tag IDs</Label>
                    <Input value={listToText(promoForm.tag)} onChange={(event) => setPromoForm({ ...promoForm, tag: textToList(event.target.value) })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Product IDs</Label>
                    <Input value={listToText(promoForm.productIds)} onChange={(event) => setPromoForm({ ...promoForm, productIds: textToList(event.target.value) })} />
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button onClick={() => save('promo', promoForm, 'settings-promo')} disabled={busy}>
                  <Save className="size-4" /> Save promo
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="fomo" className="space-y-4">
          {!fomoForm ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : (
            <>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Recent booking notifications</CardTitle>
                  <Switch checked={fomoForm.enabled} onCheckedChange={(value) => setFomoForm({ ...fomoForm, enabled: value })} />
                </CardHeader>
                <CardContent className="space-y-2">
                  {fomoForm.entries.map((entry, index) => (
                    <div key={index} className="flex flex-wrap gap-2">
                      <Input
                        className="w-40"
                        value={entry.person}
                        placeholder="Name"
                        onChange={(event) =>
                          setFomoForm({ ...fomoForm, entries: fomoForm.entries.map((item, i) => (i === index ? { ...item, person: event.target.value } : item)) })
                        }
                      />
                      <Input
                        className="w-32"
                        value={entry.country}
                        placeholder="Country"
                        onChange={(event) =>
                          setFomoForm({ ...fomoForm, entries: fomoForm.entries.map((item, i) => (i === index ? { ...item, country: event.target.value } : item)) })
                        }
                      />
                      <Input
                        className="min-w-48 flex-1"
                        value={listToText(entry.productIds)}
                        placeholder="Product IDs"
                        onChange={(event) =>
                          setFomoForm({
                            ...fomoForm,
                            entries: fomoForm.entries.map((item, i) => (i === index ? { ...item, productIds: textToList(event.target.value) } : item)),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setFomoForm({ ...fomoForm, entries: fomoForm.entries.filter((_, i) => i !== index) })}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFomoForm({ ...fomoForm, entries: [...fomoForm.entries, { person: '', country: '', productIds: [] }] })}
                  >
                    <Plus className="size-4" /> Add entry
                  </Button>
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button onClick={() => save('fomo', fomoForm, 'settings-fomo')} disabled={busy}>
                  <Save className="size-4" /> Save FOMO
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="checkout" className="space-y-4">
          {!checkoutForm ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Checkout configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Minimum travellers</Label>
                      <Input type="number" value={checkoutForm.minTravelers} onChange={(event) => setCheckoutForm({ ...checkoutForm, minTravelers: Number(event.target.value) })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Maximum travellers</Label>
                      <Input type="number" value={checkoutForm.maxTravelers} onChange={(event) => setCheckoutForm({ ...checkoutForm, maxTravelers: Number(event.target.value) })} />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm">
                      <Switch
                        checked={checkoutForm.requiresCompanyField}
                        onCheckedChange={(value) => setCheckoutForm({ ...checkoutForm, requiresCompanyField: value })}
                      />
                      Company field
                    </label>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label>Pickup options (comma separated)</Label>
                      <Input value={listToText(checkoutForm.pickupOptions)} onChange={(event) => setCheckoutForm({ ...checkoutForm, pickupOptions: textToList(event.target.value) })} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label>Departure options (comma separated)</Label>
                      <Input value={listToText(checkoutForm.departureOptions)} onChange={(event) => setCheckoutForm({ ...checkoutForm, departureOptions: textToList(event.target.value) })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Extras</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCheckoutForm({ ...checkoutForm, extras: [...checkoutForm.extras, { id: `extra-${Date.now()}`, label: '', price: 0 }] })
                        }
                      >
                        <Plus className="size-4" /> Add extra
                      </Button>
                    </div>
                    {checkoutForm.extras.map((extra, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          value={extra.label}
                          placeholder="Label"
                          onChange={(event) =>
                            setCheckoutForm({
                              ...checkoutForm,
                              extras: checkoutForm.extras.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)),
                            })
                          }
                        />
                        <Input
                          type="number"
                          className="w-32"
                          value={extra.price}
                          onChange={(event) =>
                            setCheckoutForm({
                              ...checkoutForm,
                              extras: checkoutForm.extras.map((item, i) => (i === index ? { ...item, price: Number(event.target.value) } : item)),
                            })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setCheckoutForm({ ...checkoutForm, extras: checkoutForm.extras.filter((_, i) => i !== index) })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button onClick={() => save('checkout', checkoutForm, 'settings-checkout')} disabled={busy}>
                  <Save className="size-4" /> Save checkout
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Cache</CardTitle>
              <Button variant="outline" onClick={flushCache} disabled={busy}>
                <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /> Flush cache
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs">
                {JSON.stringify(cache.data ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
