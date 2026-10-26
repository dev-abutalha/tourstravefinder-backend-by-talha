import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Save, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

type Money = Record<string, number>;
type PriceRow = {
  category: string;
  ageFrom?: number;
  ageTo?: number;
  buyingPrice?: number;
  serviceCharge?: number;
  tax?: number;
  price?: number;
};
type OptionRow = {
  name: string;
  details?: string;
  type?: string;
  capacity?: number;
  active?: boolean;
  startDate?: string;
  endDate?: string;
  repeat?: string[];
  startTime?: string[];
  prices?: PriceRow[];
  lastDays?: { days?: number; percent?: number };
  duration?: string;
  cutoff?: number;
  languages?: string[];
  index?: number;
};
type ProductForm = Record<string, any>;

const categories = ['Adult', 'Child', 'Infant', 'Youth', 'Senior'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function computed(price: PriceRow): number {
  const buying = Number(price.buyingPrice) || 0;
  const service = Number(price.serviceCharge) || 0;
  const tax = Number(price.tax) || 0;
  return Math.round((buying + service + (service * tax) / 100) * 100) / 100;
}

function emptyOption(): OptionRow {
  return {
    name: 'New option',
    details: '',
    type: 'Single Day',
    capacity: 0,
    active: true,
    startDate: '',
    endDate: '',
    repeat: [...weekdays],
    startTime: ['09:00'],
    prices: [{ category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 0, serviceCharge: 0, tax: 0, price: 0 }],
    lastDays: { days: 0, percent: 0 },
    duration: '1 day',
    cutoff: 0,
    languages: [],
  };
}

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('general');
  const [openOption, setOpenOption] = useState<number | null>(0);
  const [deleteOption, setDeleteOption] = useState<number | null>(null);

  const filters = useQuery({
    queryKey: ['product-filters'],
    queryFn: () => api.get<{ categories: { id: string; name: string }[]; tags: { id: string; name: string }[]; activityTypes: { id: string; name: string }[] }>('/admin/products/meta/filters'),
    select: (result) => result.data,
  });

  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductForm>(`/admin/products/${id}`),
    select: (result) => result.data,
    enabled: !isNew,
  });

  useEffect(() => {
    if (isNew) {
      setForm({
        title: '',
        slug: '',
        status: 'draft',
        type: 'simple',
        shortDescription: '',
        description: '',
        price: 0,
        images: [],
        gallery: [],
        categoryIds: [],
        tagIds: [],
        activityTypeIds: [],
        productOptions: [emptyOption()],
        passportRequirement: 'none',
        isFeatured: false,
        keyPoints: {},
        importantInformation: {},
        liveTourGuide: {},
        seo: {},
      });
    } else if (product.data) {
      setForm({
        ...product.data,
        images: product.data.images ?? [],
        gallery: product.data.gallery ?? [],
        categoryIds: product.data.categoryIds ?? [],
        tagIds: product.data.tagIds ?? [],
        activityTypeIds: product.data.activityTypeIds ?? [],
        productOptions: product.data.productOptions ?? [],
        keyPoints: product.data.keyPoints ?? {},
        importantInformation: product.data.importantInformation ?? {},
        liveTourGuide: product.data.liveTourGuide ?? {},
        seo: product.data.seo ?? {},
      });
    }
  }, [isNew, product.data]);

  if (isNew ? !form : product.isLoading || !form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const value = form as ProductForm;
  const options: OptionRow[] = value.productOptions ?? [];

  function set(key: string, next: unknown) {
    setForm((prev) => ({ ...(prev as ProductForm), [key]: next }));
  }

  function setNested(key: string, field: string, next: unknown) {
    setForm((prev) => ({ ...(prev as ProductForm), [key]: { ...(prev?.[key] ?? {}), [field]: next } }));
  }

  function setOption(index: number, patch: Partial<OptionRow>) {
    const next = options.map((option, i) => (i === index ? { ...option, ...patch } : option));
    set('productOptions', next);
  }

  function setPrice(optionIndex: number, priceIndex: number, patch: Partial<PriceRow>) {
    const next = options.map((option, i) => {
      if (i !== optionIndex) return option;
      const prices = (option.prices ?? []).map((price, j) => {
        if (j !== priceIndex) return price;
        const merged = { ...price, ...patch };
        return { ...merged, price: computed(merged) };
      });
      return { ...option, prices };
    });
    set('productOptions', next);
  }

  function toggleArray(key: string, item: string) {
    const current: string[] = value[key] ?? [];
    set(key, current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item]);
  }

  function toggleOptionArray(index: number, key: 'repeat' | 'startTime' | 'languages', item: string) {
    const option = options[index];
    const current = option[key] ?? [];
    setOption(index, { [key]: current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item] } as Partial<OptionRow>);
  }

  async function save() {
    setSaving(true);
    try {
      const payload: ProductForm = { ...value };
      delete payload.id;
      delete payload._id;
      delete payload.createdAt;
      delete payload.updatedAt;
      delete payload.rating;
      delete payload.bookingCount;
      delete payload.soldCount;
      payload.productOptions = options.map((option) => {
        const copy = { ...option };
        delete copy.index;
        return copy;
      });
      if (isNew) {
        const created = await api.post<ProductForm>('/admin/products', payload);
        toast.success('Product created');
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        navigate(`/products/${created.data.id}`, { replace: true });
      } else {
        await api.put(`/admin/products/${id}`, payload);
        toast.success('Product saved');
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: ['product', id] });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate('/products')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{isNew ? 'New product' : value.title}</h1>
          {!isNew && <p className="text-sm text-muted-foreground">/{value.slug}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={value.status} onValueChange={(next) => set('status', next)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="publish">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={save} disabled={saving}>
            <Save className="size-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="options">Options & pricing</TabsTrigger>
          {!isNew && <TabsTrigger value="availability">Availability</TabsTrigger>}
          {!isNew && <TabsTrigger value="reviews">Reviews</TabsTrigger>}
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input value={value.title ?? ''} onChange={(event) => set('title', event.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Slug</Label>
                    <Input value={value.slug ?? ''} onChange={(event) => set('slug', event.target.value)} placeholder="auto from title" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>SKU</Label>
                    <Input value={value.sku ?? ''} onChange={(event) => set('sku', event.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Short description</Label>
                  <Textarea rows={3} value={value.shortDescription ?? ''} onChange={(event) => set('shortDescription', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description (HTML)</Label>
                  <Textarea rows={10} value={value.description ?? ''} onChange={(event) => set('description', event.target.value)} className="font-mono text-xs" />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Publishing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex items-center justify-between text-sm">
                    Featured
                    <Switch checked={Boolean(value.isFeatured)} onCheckedChange={(next) => set('isFeatured', next)} />
                  </label>
                  <div className="space-y-1.5">
                    <Label>Passport requirement</Label>
                    <Select value={value.passportRequirement ?? 'none'} onValueChange={(next) => set('passportRequirement', next)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="single">Lead traveller only</SelectItem>
                        <SelectItem value="all">All travellers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Price (from)</Label>
                      <Input type="number" value={value.price ?? 0} onChange={(event) => set('price', Number(event.target.value))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Order</Label>
                      <Input type="number" value={value.order ?? 0} onChange={(event) => set('order', Number(event.target.value))} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Images</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(value.images ?? []).map((image: { url: string; alt?: string }, index: number) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={image.url}
                        placeholder="/images/..."
                        onChange={(event) =>
                          set(
                            'images',
                            (value.images as { url: string; alt?: string }[]).map((entry, i) => (i === index ? { ...entry, url: event.target.value } : entry)),
                          )
                        }
                      />
                      <Button variant="ghost" size="icon" onClick={() => set('images', (value.images as unknown[]).filter((_, i) => i !== index))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => set('images', [...(value.images ?? []), { url: '', alt: '' }])}>
                    <Plus className="size-4" /> Add image
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Taxonomies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="mb-2 block">Categories</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(filters.data?.categories ?? []).map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleArray('categoryIds', category.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        (value.categoryIds ?? []).includes(category.id) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Tags</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(filters.data?.tags ?? []).map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleArray('tagIds', tag.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        (value.tagIds ?? []).includes(tag.id) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Activity types</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(filters.data?.activityTypes ?? []).map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => toggleArray('activityTypeIds', type.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        (value.activityTypeIds ?? []).includes(type.id) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      {type.name}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Key points & information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                ['cancellationPolicy', 'Cancellation policy'],
                ['duration', 'Duration'],
                ['lastMinuteAvailability', 'Last-minute availability'],
                ['wheelchairAccessible', 'Wheelchair accessible'],
                ['skipTheLine', 'Skip the line'],
                ['guideType', 'Guide type'],
              ].map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input value={value.keyPoints?.[key] ?? ''} onChange={(event) => setNested('keyPoints', key, event.target.value)} />
                </div>
              ))}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Important information</Label>
                <Textarea rows={3} value={value.importantInformation?.content ?? ''} onChange={(event) => setNested('importantInformation', 'content', event.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Live tour guide</Label>
                <Textarea rows={3} value={value.liveTourGuide?.content ?? ''} onChange={(event) => setNested('liveTourGuide', 'content', event.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="options" className="space-y-3">
          {options.map((option, index) => {
            const open = openOption === index;
            return (
              <Card key={index}>
                <CardHeader className="flex-row items-center gap-3 space-y-0">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpenOption(open ? null : index)}>
                    {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    <span className="font-medium">{option.name || `Option ${index + 1}`}</span>
                    <Badge variant={option.active ? 'default' : 'secondary'}>{option.active ? 'Active' : 'Inactive'}</Badge>
                    <span className="text-xs text-muted-foreground">{option.duration}</span>
                  </button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleteOption(index)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </CardHeader>
                {open && (
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={option.name} onChange={(event) => setOption(index, { name: event.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Type</Label>
                        <Input value={option.type ?? ''} onChange={(event) => setOption(index, { type: event.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Duration</Label>
                        <Input value={option.duration ?? ''} onChange={(event) => setOption(index, { duration: event.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Capacity</Label>
                        <Input type="number" value={option.capacity ?? 0} onChange={(event) => setOption(index, { capacity: Number(event.target.value) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Cutoff (hours)</Label>
                        <Input type="number" value={option.cutoff ?? 0} onChange={(event) => setOption(index, { cutoff: Number(event.target.value) })} />
                      </div>
                      <label className="flex items-end gap-2 pb-2 text-sm">
                        <Switch checked={Boolean(option.active)} onCheckedChange={(next) => setOption(index, { active: next })} /> Active
                      </label>
                      <div className="space-y-1.5">
                        <Label>Start date</Label>
                        <Input type="date" value={option.startDate ?? ''} onChange={(event) => setOption(index, { startDate: event.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>End date</Label>
                        <Input type="date" value={option.endDate ?? ''} onChange={(event) => setOption(index, { endDate: event.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Last-minute surcharge</Label>
                        <div className="flex gap-2">
                          <Input type="number" value={option.lastDays?.days ?? 0} onChange={(event) => setOption(index, { lastDays: { ...option.lastDays, days: Number(event.target.value) } })} />
                          <Input type="number" value={option.lastDays?.percent ?? 0} onChange={(event) => setOption(index, { lastDays: { ...option.lastDays, percent: Number(event.target.value) } })} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Details</Label>
                      <Textarea rows={2} value={option.details ?? ''} onChange={(event) => setOption(index, { details: event.target.value })} />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label className="mb-2 block">Available days</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {weekdays.map((day) => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => toggleOptionArray(index, 'repeat', day)}
                              className={`rounded-full border px-2.5 py-1 text-xs ${
                                (option.repeat ?? []).includes(day) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                              }`}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="mb-2 block">Start times (HH:MM)</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {(option.startTime ?? []).map((time) => (
                            <button
                              key={time}
                              type="button"
                              onClick={() => toggleOptionArray(index, 'startTime', time)}
                              className="rounded-full border border-primary bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                            >
                              {time} ×
                            </button>
                          ))}
                          <AddTime onAdd={(time) => toggleOptionArray(index, 'startTime', time)} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Pricing</Label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setOption(index, { prices: [...(option.prices ?? []), { category: 'Adult', price: 0 }] })}
                        >
                          <Plus className="size-4" /> Add price
                        </Button>
                      </div>
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                              <th className="p-2 text-left">Category</th>
                              <th className="p-2">Age from</th>
                              <th className="p-2">Age to</th>
                              <th className="p-2">Buying</th>
                              <th className="p-2">Service</th>
                              <th className="p-2">Tax %</th>
                              <th className="p-2 text-right">Final</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {(option.prices ?? []).map((price, priceIndex) => (
                              <tr key={priceIndex} className="border-t">
                                <td className="p-1.5">
                                  <Select value={price.category} onValueChange={(next) => setPrice(index, priceIndex, { category: next })}>
                                    <SelectTrigger className="h-8 w-28">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {categories.map((category) => (
                                        <SelectItem key={category} value={category}>
                                          {category}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                {(['ageFrom', 'ageTo', 'buyingPrice', 'serviceCharge', 'tax'] as const).map((field) => (
                                  <td key={field} className="p-1.5">
                                    <Input
                                      type="number"
                                      className="h-8 w-20"
                                      value={price[field] ?? 0}
                                      onChange={(event) => setPrice(index, priceIndex, { [field]: Number(event.target.value) })}
                                    />
                                  </td>
                                ))}
                                <td className="p-2 text-right font-medium">{computed(price).toFixed(2)}</td>
                                <td className="p-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => setOption(index, { prices: (option.prices ?? []).filter((_, i) => i !== priceIndex) })}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
          <Button variant="outline" onClick={() => { set('productOptions', [...options, emptyOption()]); setOpenOption(options.length); }}>
            <Plus className="size-4" /> Add option
          </Button>
        </TabsContent>

        {!isNew && (
          <TabsContent value="availability">
            <AvailabilityPanel productId={id!} options={options} />
          </TabsContent>
        )}

        {!isNew && (
          <TabsContent value="reviews">
            <ProductReviews productId={id!} />
          </TabsContent>
        )}

        <TabsContent value="seo">
          <Card>
            <CardHeader>
              <CardTitle>Search engine optimisation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Meta title</Label>
                <Input value={value.seo?.title ?? ''} onChange={(event) => setNested('seo', 'title', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Meta description</Label>
                <Textarea rows={3} value={value.seo?.description ?? ''} onChange={(event) => setNested('seo', 'description', event.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Focus keyword</Label>
                  <Input value={value.seo?.focusKeyword ?? ''} onChange={(event) => setNested('seo', 'focusKeyword', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Canonical URL</Label>
                  <Input value={value.seo?.canonical ?? ''} onChange={(event) => setNested('seo', 'canonical', event.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={Boolean(value.seo?.noIndex)} onCheckedChange={(next) => setNested('seo', 'noIndex', next)} /> Hide from search engines
              </label>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteOption !== null}
        onOpenChange={(open) => !open && setDeleteOption(null)}
        title="Remove option?"
        description="This option and its pricing will be removed when you save."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (deleteOption === null) return;
          set('productOptions', options.filter((_, i) => i !== deleteOption));
          setDeleteOption(null);
        }}
      />
    </div>
  );
}

function AddTime({ onAdd }: { onAdd: (time: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-1">
      <Input type="time" value={value} onChange={(event) => setValue(event.target.value)} className="h-8 w-28" />
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => {
          if (!value) return;
          onAdd(value);
          setValue('');
        }}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

interface Day {
  date: string;
  available: boolean;
  reason?: string;
  times: { time: string; available: boolean; remaining: number }[];
}

function AvailabilityPanel({ productId, options }: { productId: string; options: OptionRow[] }) {
  const queryClient = useQueryClient();
  const [option, setOption] = useState('0');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const to = useMemo(() => new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10), []);
  const [busy, setBusy] = useState(false);

  const calendar = useQuery({
    queryKey: ['availability', productId, option, from, to],
    queryFn: () =>
      api.get<{ calendar: Day[]; options: { index: number; name: string; startTime: string[] }[] }>(
        `/admin/products/${productId}/availability?option=${option}&from=${from}&to=${to}`,
      ),
    select: (result) => result.data,
  });

  async function toggle(day: string, time: string, unavailable: boolean, quantity?: number) {
    setBusy(true);
    try {
      await api.post(`/admin/products/${productId}/availability`, { option: Number(option), date: day, time, unavailable, quantity });
      void queryClient.invalidateQueries({ queryKey: ['availability', productId, option, from, to] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability calendar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label>Option</Label>
            <Select value={option} onValueChange={setOption}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((entry, index) => (
                  <SelectItem key={index} value={String(index)}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40" />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">Next 30 days · click a time to block/unblock</p>
        </div>

        {calendar.isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {(calendar.data?.calendar ?? []).map((day) => (
              <div key={day.date} className={`rounded-lg border p-2.5 ${day.available ? '' : 'bg-muted/40'}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium">{date(day.date)}</span>
                  {!day.available && <Badge variant="secondary" className="text-[10px]">closed</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {day.times.length === 0 && <span className="text-xs text-muted-foreground">All day</span>}
                  {day.times.map((slot) => (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(day.date, slot.time, slot.available)}
                      title={slot.remaining > 0 ? `${slot.remaining} seats left` : 'Unlimited'}
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        slot.available ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/15 text-destructive line-through'
                      }`}
                    >
                      {slot.time}
                      {slot.remaining > 0 && <span className="ml-1 opacity-70">{slot.remaining}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ReviewRow {
  id: string;
  authorName: string;
  rating: number;
  title?: string;
  content: string;
  status: string;
  createdAt: string;
}

function ProductReviews({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['product-reviews', productId], queryFn: () => api.get<ReviewRow[]>(`/admin/products/${productId}/reviews`), select: (result) => result.data });
  const [authorName, setAuthorName] = useState('');
  const [rating, setRating] = useState('5');
  const [content, setContent] = useState('');

  async function add() {
    try {
      await api.post(`/admin/products/${productId}/reviews`, { authorName, rating: Number(rating), content, status: 'approved' });
      toast.success('Review added');
      setAuthorName('');
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['product-reviews', productId] });
      void queryClient.invalidateQueries({ queryKey: ['product', productId] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Reviews ({query.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
          {query.data?.map((review) => (
            <div key={review.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{review.authorName}</span>
                <span className="flex items-center gap-0.5 text-amber-500">
                  {Array.from({ length: review.rating }).map((_, index) => (
                    <Star key={index} className="size-3.5 fill-current" />
                  ))}
                </span>
              </div>
              {review.title && <p className="text-sm font-medium">{review.title}</p>}
              <p className="text-sm text-muted-foreground">{review.content}</p>
              <p className="mt-1 text-xs text-muted-foreground">{date(review.createdAt, true)}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input value={authorName} onChange={(event) => setAuthorName(event.target.value)} placeholder="Author name" />
          <Select value={rating} onValueChange={setRating}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 4, 3, 2, 1].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value} star{value > 1 ? 's' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea rows={4} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Review content" />
          <Button className="w-full" disabled={!authorName || !content} onClick={add}>
            Add review
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
