/**
 * Development seeder.
 *
 * Idempotent: every record is upserted by its natural key (slug/code/email),
 * so running the script repeatedly is safe. Pass `--reset` to wipe the
 * collections this script owns first (never touches orders/users unless
 * `--reset` is passed).
 *
 *   npx tsx src/scripts/seed.ts
 *   npx tsx src/scripts/seed.ts --reset
 */
import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import {
  Category,
  Coupon,
  Faq,
  FaqCategory,
  Order,
  Page,
  Post,
  Product,
  Review,
  Showcase,
  Taxonomy,
  User,
  type ProductOptionInput,
} from '../models/index.js';
import {
  DEFAULT_CHECKOUT_SETTINGS,
  DEFAULT_FRAUD_SETTINGS,
  DEFAULT_PROMO_SETTINGS,
  saveCheckoutSettings,
  saveFraudSettings,
  savePromoSettings,
  saveSiteSettings,
  type SiteSettings,
} from '../services/settings.service.js';

const RESET = process.argv.includes('--reset');
const IMG = (name: string) => `/images/banner/${name}`;

const log = (message: string) => console.log(`[seed] ${message}`);

async function reset() {
  log('reset requested - clearing content collections');
  await Promise.all([
    Product.deleteMany({}),
    Category.deleteMany({}),
    Taxonomy.deleteMany({}),
    Review.deleteMany({}),
    Faq.deleteMany({}),
    FaqCategory.deleteMany({}),
    Showcase.deleteMany({}),
    Page.deleteMany({}),
    Post.deleteMany({}),
    Coupon.deleteMany({}),
    Order.deleteMany({}),
  ]);
}

async function seedSettings() {
  const site: SiteSettings = {
    siteName: env.SITE_NAME,
    siteUrl: env.SITE_URL,
    supportEmail: env.SUPPORT_EMAIL,
    adminEmail: env.ADMIN_EMAIL,
    currency: env.CURRENCY,
    currencySymbol: env.CURRENCY_SYMBOL,
    mailFromName: env.MAIL_FROM_NAME,
    mailFromAddress: env.MAIL_FROM_ADDRESS,
    phoneCountries: env.PHONE_COUNTRIES,
    socials: [
      { label: 'Facebook', url: 'https://facebook.com', icon: 'facebook' },
      { label: 'Instagram', url: 'https://instagram.com', icon: 'instagram' },
      { label: 'X', url: 'https://x.com', icon: 'twitter' },
    ],
    analytics: {},
    seo: {
      title: `${env.SITE_NAME} - Tours, Tickets & Experiences`,
      description: 'Book the best tours, attraction tickets and experiences worldwide.',
      ogImage: IMG('about-us.webp'),
    },
    booking: {
      reservationMinutes: env.BOOKING_RESERVATION_MINUTES,
      freeCancellationHours: env.FREE_CANCELLATION_HOURS,
    },
    blockedEmailDomains: [],
  };
  await saveSiteSettings(site);
  await savePromoSettings({
    ...DEFAULT_PROMO_SETTINGS,
    showBanner: true,
    title: 'Summer escape sale',
    offerText: 'Up to 20% off selected tours and attraction tickets.',
    buttonText: 'Explore deals',
    buttonLink: '/things-to-do',
    bgImage: IMG('about-us-2.webp'),
  });
  await saveFraudSettings(DEFAULT_FRAUD_SETTINGS);
  await saveCheckoutSettings(DEFAULT_CHECKOUT_SETTINGS);
  log('settings written');
}

async function seedUsers() {
  const people = [
    { email: env.ADMIN_EMAIL, password: 'Admin@12345', role: 'admin', firstName: 'Site', lastName: 'Admin' },
    { email: 'manager@example.com', password: 'Manager@12345', role: 'manager', firstName: 'Mia', lastName: 'Manager' },
    { email: 'customer@example.com', password: 'Customer@12345', role: 'customer', firstName: 'Chris', lastName: 'Traveller' },
  ] as const;

  for (const person of people) {
    const existing = await User.findOne({ email: person.email });
    if (existing) continue;
    await User.create({
      email: person.email,
      passwordHash: await bcrypt.hash(person.password, 12),
      firstName: person.firstName,
      lastName: person.lastName,
      displayName: `${person.firstName} ${person.lastName}`,
      role: person.role,
      emailVerified: true,
      isActive: true,
    });
    log(`user ${person.email} (${person.role})`);
  }
}

interface CategorySeed {
  name: string;
  type: 'country' | 'city' | 'attraction' | '';
  parent?: string;
  topExperience?: boolean;
  topAttraction?: boolean;
  image?: string;
  icon?: string;
}

async function seedCategories(): Promise<Record<string, { id: string; name: string; slug: string }>> {
  const seeds: CategorySeed[] = [
    { name: 'France', type: 'country', image: IMG('about-us-1.webp') },
    { name: 'Italy', type: 'country', image: IMG('about-us-2.webp') },
    { name: 'Spain', type: 'country', image: IMG('about-us-3.webp') },
    { name: 'United Arab Emirates', type: 'country', image: IMG('about-us.webp') },
    { name: 'United States', type: 'country', image: IMG('about-us-1.webp') },

    { name: 'Paris', type: 'city', parent: 'France', topExperience: true, image: IMG('about-us-1.webp') },
    { name: 'Rome', type: 'city', parent: 'Italy', topExperience: true, image: IMG('about-us-2.webp') },
    { name: 'Barcelona', type: 'city', parent: 'Spain', topExperience: true, image: IMG('about-us-3.webp') },
    { name: 'Dubai', type: 'city', parent: 'United Arab Emirates', topExperience: true, image: IMG('about-us.webp') },
    { name: 'New York', type: 'city', parent: 'United States', topExperience: true, image: IMG('about-us-1.webp') },

    { name: 'Eiffel Tower', type: 'attraction', parent: 'Paris', topAttraction: true, image: IMG('about-us-1.webp') },
    { name: 'Colosseum', type: 'attraction', parent: 'Rome', topAttraction: true, image: IMG('about-us-2.webp') },
    { name: 'Sagrada Familia', type: 'attraction', parent: 'Barcelona', topAttraction: true, image: IMG('about-us-3.webp') },
    { name: 'Burj Khalifa', type: 'attraction', parent: 'Dubai', topAttraction: true, image: IMG('about-us.webp') },
    { name: 'Statue of Liberty', type: 'attraction', parent: 'New York', topAttraction: true, image: IMG('about-us-1.webp') },
  ];

  const byName: Record<string, { id: string; name: string; slug: string }> = {};

  for (const seed of seeds) {
    const slug = slugify(seed.name, { lower: true, strict: true });
    const doc = await Category.findOneAndUpdate(
      { slug },
      {
        $set: {
          name: seed.name,
          slug,
          parentId: seed.parent ? byName[seed.parent]?.id ?? null : null,
          categoryType: seed.type,
          topExperience: seed.topExperience ?? false,
          topAttraction: seed.topAttraction ?? false,
          image: seed.image ?? '',
          icon: seed.icon ?? '',
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    byName[seed.name] = { id: String(doc._id), name: doc.name, slug: doc.slug };
  }

  log(`${seeds.length} categories`);
  return byName;
}

async function seedTaxonomies() {
  const groups = {
    product_tag: ['Skip the line', 'Guided tour', 'Family friendly', 'Small group', 'Best seller'],
    activity_type: ['Walking tour', 'Museum', 'Cruise', 'Day trip', 'Adventure'],
  } as const;

  const byName: Record<string, { id: string; name: string }> = {};

  for (const [kind, names] of Object.entries(groups)) {
    for (const name of names) {
      const slug = `${kind === 'product_tag' ? 'tag' : 'activity'}-${slugify(name, { lower: true, strict: true })}`;
      const doc = await Taxonomy.findOneAndUpdate(
        { slug },
        { $set: { name, slug, kind } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      byName[`${kind}:${name}`] = { id: String(doc._id), name: doc.name };
    }
  }

  log('taxonomies');
  return byName;
}

interface ProductSeed {
  title: string;
  category: string;
  tags: string[];
  activity: string;
  image: string;
  featured?: boolean;
  short: string;
  description: string;
  duration: string;
  cancellation: string;
  options: ProductOptionInput[];
}

function adultPrice(option: ProductOptionInput) {
  const adult = option.prices?.find((p) => p.category === 'Adult') ?? option.prices?.[0];
  return Math.round(((adult?.buyingPrice ?? 0) + (adult?.serviceCharge ?? 0) + ((adult?.serviceCharge ?? 0) * (adult?.tax ?? 0)) / 100) * 100) / 100;
}

const productSeeds: ProductSeed[] = [
  {
    title: 'Eiffel Tower Summit Access with Host',
    category: 'Eiffel Tower',
    tags: ['Skip the line', 'Best seller'],
    activity: 'Museum',
    image: IMG('about-us-1.webp'),
    featured: true,
    short: 'Skip the queues and ride to the summit of the Eiffel Tower with a friendly host.',
    description: '<p>Ascend to the summit of the Eiffel Tower and enjoy sweeping views across Paris. Your host meets you nearby, fast-tracks you through security and shares the story of the Iron Lady.</p><ul><li>Priority access to the summit</li><li>Live host in English</li><li>Flexible departure times</li></ul>',
    duration: '2 hours',
    cancellation: 'Free cancellation up to 24 hours before travel',
    options: [
      {
        name: 'Summit Access',
        details: 'Access to the 2nd floor and summit.',
        type: 'Single Day',
        capacity: 25,
        active: true,
        startTime: ['09:00', '13:00', '17:00'],
        duration: '2 hours',
        languages: ['English', 'French'],
        lastDays: { days: 2, percent: 10 },
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 45, serviceCharge: 10, tax: 10 },
          { category: 'Child', ageFrom: 4, ageTo: 17, buyingPrice: 25, serviceCharge: 6, tax: 10 },
          { category: 'Infant', ageFrom: 0, ageTo: 3, buyingPrice: 0, serviceCharge: 0, tax: 0 },
        ],
      },
      {
        name: '2nd Floor Only',
        details: 'Access to the second floor observation deck.',
        type: 'Single Day',
        capacity: 30,
        active: true,
        startTime: ['10:00', '15:00'],
        duration: '1.5 hours',
        languages: ['English'],
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 30, serviceCharge: 8, tax: 10 },
          { category: 'Child', ageFrom: 4, ageTo: 17, buyingPrice: 18, serviceCharge: 5, tax: 10 },
        ],
      },
    ],
  },
  {
    title: 'Colosseum Underground & Arena Tour',
    category: 'Colosseum',
    tags: ['Skip the line', 'Guided tour', 'Small group'],
    activity: 'Walking tour',
    image: IMG('about-us-2.webp'),
    featured: true,
    short: 'Explore the gladiator arena, underground tunnels and Roman Forum with an expert guide.',
    description: '<p>Go beneath the Colosseum floor to the tunnels where gladiators and wild animals waited. Then walk the arena floor and the Roman Forum with a licensed guide.</p>',
    duration: '3 hours',
    cancellation: 'Free cancellation up to 48 hours before travel',
    options: [
      {
        name: 'Underground Small Group',
        details: 'Maximum 12 guests.',
        type: 'Single Day',
        capacity: 12,
        active: true,
        startTime: ['09:30', '14:00'],
        duration: '3 hours',
        languages: ['English', 'Italian', 'Spanish'],
        lastDays: { days: 3, percent: 15 },
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 55, serviceCharge: 12, tax: 10 },
          { category: 'Child', ageFrom: 6, ageTo: 17, buyingPrice: 32, serviceCharge: 7, tax: 10 },
        ],
      },
    ],
  },
  {
    title: 'Sagrada Familia Skip-the-Line Ticket',
    category: 'Sagrada Familia',
    tags: ['Skip the line', 'Family friendly'],
    activity: 'Museum',
    image: IMG('about-us-3.webp'),
    featured: true,
    short: 'Marvel at Gaudi\'s masterpiece with fast-track entry and an optional tower visit.',
    description: '<p>Discover the Basilica of the Sagrada Familia at your own pace with a timed-entry ticket. Add a tower access option for panoramic views over Barcelona.</p>',
    duration: '1.5 hours',
    cancellation: 'Free cancellation up to 24 hours before travel',
    options: [
      {
        name: 'Basilica Entry',
        details: 'Timed entry to the basilica.',
        type: 'Single Day',
        capacity: 40,
        active: true,
        startTime: ['10:00', '12:00', '16:00'],
        duration: '1.5 hours',
        languages: ['English', 'Catalan'],
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 22, serviceCharge: 5, tax: 10 },
          { category: 'Child', ageFrom: 0, ageTo: 17, buyingPrice: 14, serviceCharge: 3, tax: 10 },
          { category: 'Senior', ageFrom: 65, ageTo: 120, buyingPrice: 18, serviceCharge: 4, tax: 10 },
        ],
      },
      {
        name: 'Basilica + Tower',
        details: 'Entry plus tower lift access.',
        type: 'Single Day',
        capacity: 20,
        active: true,
        startTime: ['11:00', '15:00'],
        duration: '2 hours',
        languages: ['English'],
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 36, serviceCharge: 8, tax: 10 },
          { category: 'Child', ageFrom: 6, ageTo: 17, buyingPrice: 28, serviceCharge: 6, tax: 10 },
        ],
      },
    ],
  },
  {
    title: 'Burj Khalifa At the Top - Levels 124 & 125',
    category: 'Burj Khalifa',
    tags: ['Skip the line', 'Best seller'],
    activity: 'Museum',
    image: IMG('about-us.webp'),
    featured: true,
    short: 'Ride the world\'s fastest lift to the 124th and 125th floors of the Burj Khalifa.',
    description: '<p>See Dubai from above at the iconic Burj Khalifa observation decks. Timed tickets let you choose sunrise, daytime or sunset slots.</p>',
    duration: '1.5 hours',
    cancellation: 'Free cancellation up to 72 hours before travel',
    options: [
      {
        name: 'Levels 124 & 125',
        details: 'Prime observation decks.',
        type: 'Single Day',
        capacity: 60,
        active: true,
        startTime: ['09:00', '12:00', '17:00', '19:00'],
        duration: '1.5 hours',
        languages: ['English', 'Arabic'],
        lastDays: { days: 1, percent: 5 },
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 38, serviceCharge: 9, tax: 5 },
          { category: 'Child', ageFrom: 4, ageTo: 17, buyingPrice: 30, serviceCharge: 7, tax: 5 },
          { category: 'Infant', ageFrom: 0, ageTo: 3, buyingPrice: 0, serviceCharge: 0, tax: 0 },
        ],
      },
    ],
  },
  {
    title: 'Statue of Liberty & Ellis Island Ferry',
    category: 'Statue of Liberty',
    tags: ['Family friendly', 'Best seller'],
    activity: 'Cruise',
    image: IMG('about-us-2.webp'),
    featured: false,
    short: 'Ferry to Liberty Island and Ellis Island with museum access included.',
    description: '<p>Sail from Battery Park to the Statue of Liberty and Ellis Island. Includes ferry rides and entry to both museums.</p>',
    duration: '4 hours',
    cancellation: 'Free cancellation up to 24 hours before travel',
    options: [
      {
        name: 'Standard Ferry + Museums',
        details: 'Round-trip ferry and museum entry.',
        type: 'Single Day',
        capacity: 80,
        active: true,
        startTime: ['08:30', '10:30', '13:00'],
        duration: '4 hours',
        languages: ['English'],
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 26, serviceCharge: 6, tax: 8 },
          { category: 'Child', ageFrom: 4, ageTo: 17, buyingPrice: 16, serviceCharge: 4, tax: 8 },
        ],
      },
    ],
  },
  {
    title: 'Paris Seine River Sightseeing Cruise',
    category: 'Paris',
    tags: ['Family friendly', 'Guided tour'],
    activity: 'Cruise',
    image: IMG('about-us-3.webp'),
    featured: false,
    short: 'Glide past Notre-Dame and the Louvre on a one-hour Seine cruise.',
    description: '<p>Board a glass-roofed boat and see Paris from the water. Audio guides in ten languages are included.</p>',
    duration: '1 hour',
    cancellation: 'Free cancellation up to 24 hours before travel',
    options: [
      {
        name: '1-Hour Sightseeing Cruise',
        details: 'Open ticket valid all day.',
        type: 'Single Day',
        capacity: 100,
        active: true,
        startTime: ['10:00', '12:00', '14:00', '16:00', '18:00'],
        duration: '1 hour',
        languages: ['English', 'French', 'Spanish', 'German'],
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 14, serviceCharge: 4, tax: 10 },
          { category: 'Child', ageFrom: 4, ageTo: 17, buyingPrice: 8, serviceCharge: 2, tax: 10 },
          { category: 'Infant', ageFrom: 0, ageTo: 3, buyingPrice: 0, serviceCharge: 0, tax: 0 },
        ],
      },
    ],
  },
  {
    title: 'Rome Trastevere Food Walking Tour',
    category: 'Rome',
    tags: ['Guided tour', 'Small group'],
    activity: 'Walking tour',
    image: IMG('about-us-1.webp'),
    featured: false,
    short: 'Taste Rome\'s best street food and wine across Trastevere\'s cobbled lanes.',
    description: '<p>Join a local foodie for a progressive dinner through Trastevere. Ten tastings including supplì, pizza bianca, pasta and gelato.</p>',
    duration: '3.5 hours',
    cancellation: 'Free cancellation up to 24 hours before travel',
    options: [
      {
        name: 'Evening Food Tour',
        details: 'All tastings included.',
        type: 'Single Day',
        capacity: 14,
        active: true,
        startTime: ['17:30'],
        duration: '3.5 hours',
        languages: ['English'],
        lastDays: { days: 2, percent: 10 },
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 62, serviceCharge: 14, tax: 10 },
          { category: 'Youth', ageFrom: 12, ageTo: 17, buyingPrice: 40, serviceCharge: 9, tax: 10 },
        ],
      },
    ],
  },
  {
    title: 'Barcelona Gothic Quarter Walking Tour',
    category: 'Barcelona',
    tags: ['Guided tour', 'Small group'],
    activity: 'Walking tour',
    image: IMG('about-us-2.webp'),
    featured: false,
    short: 'Uncover two thousand years of history in Barcelona\'s old town.',
    description: '<p>Wander the Gothic Quarter\'s hidden squares and Roman ruins with a local historian.</p>',
    duration: '2 hours',
    cancellation: 'Free cancellation up to 24 hours before travel',
    options: [
      {
        name: 'Gothic Quarter Walk',
        details: 'Small-group walking tour.',
        type: 'Single Day',
        capacity: 18,
        active: true,
        startTime: ['10:00', '16:00'],
        duration: '2 hours',
        languages: ['English', 'Spanish'],
        prices: [
          { category: 'Adult', ageFrom: 18, ageTo: 99, buyingPrice: 18, serviceCharge: 5, tax: 10 },
          { category: 'Child', ageFrom: 6, ageTo: 17, buyingPrice: 10, serviceCharge: 3, tax: 10 },
        ],
      },
    ],
  },
];

async function seedProducts(
  categories: Record<string, { id: string; name: string; slug: string }>,
  taxonomies: Record<string, { id: string; name: string }>,
): Promise<{ id: string; slug: string; title: string; image: string; price: number }[]> {
  const out: { id: string; slug: string; title: string; image: string; price: number }[] = [];
  for (const seed of productSeeds) {
    const slug = slugify(seed.title, { lower: true, strict: true });
    const category = categories[seed.category];
    const price = adultPrice(seed.options[0]);
    const doc = await Product.findOneAndUpdate(
      { slug },
      {
        $set: {
          title: seed.title,
          slug,
          status: 'publish',
          type: 'variable',
          shortDescription: seed.short,
          description: seed.description,
          content: seed.description,
          price,
          regularPrice: price,
          images: [{ url: seed.image, alt: seed.title }],
          categoryIds: category ? [category.id] : [],
          tagIds: seed.tags.map((t) => taxonomies[`product_tag:${t}`]?.id).filter(Boolean),
          activityTypeIds: [taxonomies[`activity_type:${seed.activity}`]?.id].filter(Boolean),
          productOptions: seed.options.map((option) => ({
            ...option,
            prices: (option.prices ?? []).map((p) => ({
              ...p,
              price:
                Math.round(
                  ((p.buyingPrice ?? 0) + (p.serviceCharge ?? 0) + ((p.serviceCharge ?? 0) * (p.tax ?? 0)) / 100) * 100,
                ) / 100,
            })),
          })),
          keyPoints: {
            cancellationPolicy: seed.cancellation,
            duration: seed.duration,
            lastMinuteAvailability: 'Subject to availability',
            wheelchairAccessible: 'Please contact us',
            skipTheLine: 'Yes',
            guideType: 'Live guide',
          },
          importantInformation: {
            title: 'Important information',
            content: '<p>Please arrive 15 minutes before your scheduled time and bring a valid photo ID.</p>',
          },
          liveTourGuide: { title: 'Live tour guide', content: '<p>English, Spanish, French and Italian available.</p>' },
          isFeatured: seed.featured ?? false,
          bookingCount: Math.floor(Math.random() * 300) + 20,
          soldCount: Math.floor(Math.random() * 600) + 40,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    out.push({ id: String(doc._id), slug: doc.slug, title: doc.title, image: seed.image, price });
  }
  log(`${out.length} products`);
  return out;
}

async function seedShowcases(categories: Record<string, { id: string; name: string; slug: string }>) {
  const destinations = ['Paris', 'Rome', 'Barcelona', 'Dubai', 'New York'];
  const attractions = ['Eiffel Tower', 'Colosseum', 'Sagrada Familia', 'Burj Khalifa', 'Statue of Liberty'];

  await Showcase.findOneAndUpdate(
    { slug: 'top-destinations' },
    {
      $set: {
        kind: 'destination',
        title: 'Top Destinations',
        slug: 'top-destinations',
        status: 'publish',
        subtitle: 'Where travellers are heading right now',
        items: destinations.map((name, index) => ({
          title: name,
          subtitle: categories[name]?.slug ? 'Explore experiences' : '',
          description: `Discover the best tours and tickets in ${name}.`,
          image: IMG(index % 2 === 0 ? 'about-us-1.webp' : 'about-us-3.webp'),
          link: `/destination/${categories[name]?.slug ?? slugify(name, { lower: true, strict: true })}`,
          pageTitle: name,
          order: index,
        })),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  await Showcase.findOneAndUpdate(
    { slug: 'top-attractions' },
    {
      $set: {
        kind: 'attraction',
        title: 'Top Attractions',
        slug: 'top-attractions',
        status: 'publish',
        subtitle: 'Skip-the-line tickets to the icons',
        items: attractions.map((name, index) => ({
          title: name,
          subtitle: 'Skip the line',
          description: `Book tickets to ${name} with instant confirmation.`,
          image: IMG(index % 2 === 0 ? 'about-us-2.webp' : 'about-us.webp'),
          link: `/attraction/${categories[name]?.slug ?? slugify(name, { lower: true, strict: true })}`,
          pageTitle: name,
          order: index,
        })),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  log('showcases');
}

async function seedFaqs() {
  const categoryNames = ['Booking', 'Cancellation', 'Payments', 'Travel'];
  const ids: Record<string, string> = {};
  for (const name of categoryNames) {
    const slug = slugify(name, { lower: true, strict: true });
    const doc = await FaqCategory.findOneAndUpdate(
      { slug },
      { $set: { name, slug } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    ids[name] = String(doc._id);
  }

  const faqs = [
    ['How do I book a tour?', 'Booking', 'Choose your date, select travellers and complete checkout. You will receive a confirmation email instantly.'],
    ['When will I receive my tickets?', 'Booking', 'Tickets are sent by email within minutes of your payment being confirmed. You can also download them from your account.'],
    ['Can I cancel my booking?', 'Cancellation', 'Most experiences offer free cancellation up to 24 hours before the travel date. Check the cancellation policy on the product page.'],
    ['How do refunds work?', 'Cancellation', 'Approved refunds are returned to the original payment method within 5-10 business days.'],
    ['Which payment methods are accepted?', 'Payments', 'We accept all major cards, PayPal and bank transfer. Payments are processed securely.'],
    ['Is my payment secure?', 'Payments', 'Yes. Card data is encrypted in transit and never stored on our servers.'],
    ['Do I need to print my ticket?', 'Travel', 'No. A mobile ticket on your phone is accepted at most attractions.'],
    ['What should I bring?', 'Travel', 'Bring a valid photo ID, comfortable shoes and the booking confirmation on your phone.'],
  ] as const;

  for (const [index, [title, category, content]] of faqs.entries()) {
    const slug = slugify(title, { lower: true, strict: true });
    await Faq.findOneAndUpdate(
      { slug },
      {
        $set: {
          title,
          slug,
          status: 'publish',
          content: `<p>${content}</p>`,
          excerpt: content,
          categoryIds: [ids[category]],
          order: index,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  log(`${faqs.length} faqs`);
}

async function seedPages() {
  const pages = [
    ['Home', 'home', 'default', 'Book unforgettable tours and attraction tickets.'],
    ['Things to do', 'things-to-do', 'destination', 'Browse experiences by city and country.'],
    ['Top attractions', 'top-attractions', 'attraction', 'Skip-the-line tickets to the world\'s icons.'],
    ['FAQ', 'faq', 'faq', 'Answers to the most common questions.'],
    ['Order status', 'order-status', 'order-status', 'Track your booking.'],
    ['About us', 'about-us', 'default', 'We are a team of travel obsessives.'],
    ['Contact', 'contact', 'default', 'Get in touch with our support team.'],
    ['Terms & conditions', 'terms', 'default', 'The terms that apply to your booking.'],
    ['Privacy policy', 'privacy', 'default', 'How we handle your personal data.'],
  ] as const;

  for (const [title, slug, template, excerpt] of pages) {
    await Page.findOneAndUpdate(
      { slug },
      {
        $set: {
          title,
          slug,
          template,
          status: 'publish',
          excerpt,
          content: `<p>${excerpt}</p>`,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  log(`${pages.length} pages`);
}

async function seedPosts() {
  const posts = [
    ['10 things to do in Paris this summer', '10-things-to-do-in-paris', 'From rooftop bars to Seine cruises, here is how to make the most of Paris.'],
    ['A first-timer\'s guide to the Colosseum', 'first-timers-guide-colosseum', 'Everything you need to know before visiting Rome\'s most famous monument.'],
    ['48 hours in Barcelona', '48-hours-in-barcelona', 'Gaudi, tapas and the beach: a perfect weekend itinerary.'],
    ['Dubai on a budget', 'dubai-on-a-budget', 'How to experience the best of Dubai without breaking the bank.'],
  ] as const;

  for (const [title, slug, excerpt] of posts) {
    await Post.findOneAndUpdate(
      { slug },
      {
        $set: {
          title,
          slug,
          status: 'publish',
          excerpt,
          content: `<p>${excerpt}</p>`,
          contentHtml: `<p>${excerpt}</p>`,
          authorName: 'Travel Desk',
          image: IMG('about-us.webp'),
          readingMinutes: 4,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  log(`${posts.length} posts`);
}

async function seedCoupons() {
  const coupons = [
    { code: 'WELCOME10', type: 'percent', amount: 10, description: '10% off your first booking' },
    { code: 'SUMMER20', type: 'fixed_cart', amount: 20, description: '€20 off orders over €100', minimumAmount: 100 },
    { code: 'TRAVEL15', type: 'percent', amount: 15, description: '15% off selected tours' },
  ] as const;

  for (const coupon of coupons) {
    await Coupon.findOneAndUpdate(
      { code: coupon.code },
      { $set: { ...coupon, active: true } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  log(`${coupons.length} coupons`);
}

async function seedReviews(products: { id: string; title: string }[]) {
  const reviewers = [
    ['Sophie Martin', 'sophie@example.com', 5, 'Absolutely worth it'],
    ['James Carter', 'james@example.com', 4, 'Great experience'],
    ['Lucia Rossi', 'lucia@example.com', 5, 'Highly recommended'],
    ['Daniel Kim', 'daniel@example.com', 5, 'Seamless from start to finish'],
  ] as const;

  let count = 0;
  for (const product of products) {
    for (const [index, [authorName, authorEmail, rating, title]] of reviewers.slice(0, 3).entries()) {
      const existing = await Review.findOne({ productId: product.id, authorEmail });
      if (existing) continue;
      await Review.create({
        productId: product.id,
        authorName,
        authorEmail,
        rating,
        title,
        content: `${title}. Booking was easy and the experience matched the description.`,
        status: 'approved',
        source: index === 0 ? 'customer' : 'manual',
        verifiedBooking: index === 0,
      });
      count += 1;
    }
  }
  log(`${count} reviews`);
}

async function seedOrders(products: { id: string; slug: string; title: string; image: string; price: number }[]) {
  const existing = await Order.countDocuments();
  if (existing > 0) {
    log(`orders already present (${existing}) - skipping`);
    return;
  }

  const customer = await User.findOne({ email: 'customer@example.com' });
  const statuses = ['pending', 'booking-confirm', 'completed'] as const;

  for (const [index, status] of statuses.entries()) {
    const product = products[index % products.length];
    const travelers = { Adult: 2 };
    const subtotal = Math.round(product.price * 2 * 100) / 100;
    const order = await Order.create({
      orderNumber: `TTF-SEED${index + 1}`,
      status,
      paymentStatus: status === 'completed' ? 'paid' : 'pending',
      paymentMethod: 'cod',
      currency: env.CURRENCY,
      subtotal,
      total: subtotal,
      items: [
        {
          productId: product.id,
          productSlug: product.slug,
          productTitle: product.title,
          productImage: product.image,
          optionName: 'Standard',
          date: new Date(Date.now() + (index + 3) * 86400000).toISOString().slice(0, 10),
          time: '10:00',
          travelers,
          travelerCount: 2,
          unitPrice: product.price,
          dynamicPrice: subtotal,
          total: subtotal,
        },
      ],
      userId: customer?._id ?? null,
      customerEmail: 'customer@example.com',
      customerPhone: '+34 600 000 000',
      billing: { firstName: 'Chris', lastName: 'Traveller', email: 'customer@example.com', country: 'ES' },
      travelerCount: 2,
      passengers: [
        { firstName: 'Chris', lastName: 'Traveller', isLead: true },
        { firstName: 'Alex', lastName: 'Traveller' },
      ],
      reviewEnabled: status === 'completed',
      attribution: { sourceType: 'direct', deviceType: 'desktop' },
      fraud: { level: 'allowed', score: 5, reasons: [] },
    });
    log(`order ${order.orderNumber} (${status})`);
  }
}

async function recalcCounts() {
  const categories = await Category.find();
  for (const category of categories) {
    const productCount = await Product.countDocuments({ status: 'publish', categoryIds: category._id });
    await Category.updateOne({ _id: category._id }, { $set: { productCount } });
  }

  const taxonomies = await Taxonomy.find();
  for (const taxonomy of taxonomies) {
    const field = taxonomy.kind === 'product_tag' ? 'tagIds' : 'activityTypeIds';
    const productCount = await Product.countDocuments({ status: 'publish', [field]: taxonomy._id });
    await Taxonomy.updateOne({ _id: taxonomy._id }, { $set: { productCount } });
  }

  const faqCategories = await FaqCategory.find();
  for (const category of faqCategories) {
    const faqCount = await Faq.countDocuments({ categoryIds: category._id });
    await FaqCategory.updateOne({ _id: category._id }, { $set: { faqCount } });
  }

  const products = await Product.find();
  for (const product of products) {
    const reviews = await Review.find({ productId: product._id, status: 'approved' });
    const count = reviews.length;
    const average = count ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 : 0;
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<string, number>;
    for (const review of reviews) counts[String(review.rating)] = (counts[String(review.rating)] ?? 0) + 1;
    await Product.updateOne({ _id: product._id }, { $set: { rating: { average, count, rated: count, counts } } });
  }

  log('counts & ratings recalculated');
}

async function main() {
  await connectDatabase();
  if (RESET) await reset();

  await seedUsers();
  await seedSettings();
  const categories = await seedCategories();
  const taxonomies = await seedTaxonomies();
  const products = await seedProducts(categories, taxonomies);
  await seedShowcases(categories);
  await seedFaqs();
  await seedPages();
  await seedPosts();
  await seedCoupons();
  await seedReviews(products);
  await seedOrders(products);
  await recalcCounts();

  log('done');
  log(`admin login: ${env.ADMIN_EMAIL} / Admin@12345`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('[seed] failed', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
