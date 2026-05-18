/**
 * Prisma Database Seed Script
 *
 * Populates representative data for the admin dashboard:
 * - Admin identities
 * - Dreamers and interpreters
 * - Plans
 * - Dreams in multiple statuses
 * - Requests and chat messages
 * - Payments and dream plan purchases
 * - Static content pages
 * - Notifications, comments, messages, and admin logs
 *
 * Run with: npm run prisma:seed
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const ids = {
  superAdmin: "seed-super-admin",
  regularAdmin: "seed-regular-admin",
  interpreterAhmed: "seed-interpreter-ahmed",
  interpreterMona: "seed-interpreter-mona",
  interpreterYoussef: "seed-interpreter-youssef",
  dreamerMohamed: "seed-dreamer-mohamed",
  dreamerSara: "seed-dreamer-sara",
  dreamerOmar: "seed-dreamer-omar",
  dreamWedding: "seed-dream-wedding",
  dreamSea: "seed-dream-sea",
  dreamKeys: "seed-dream-keys",
  dreamTravel: "seed-dream-travel",
  dreamLight: "seed-dream-light",
  requestWedding: "seed-request-wedding",
  requestSea: "seed-request-sea",
  requestKeys: "seed-request-keys",
  paymentWedding: "seed-payment-wedding",
  paymentSea: "seed-payment-sea",
  paymentFailed: "seed-payment-failed",
};

async function upsertUser({ id, email, password, profile }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing && existing.id !== id) {
    await prisma.user.delete({ where: { id: existing.id } });
  }

  return prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      profile: {
        upsert: {
          update: {
            email,
            ...profile,
          },
          create: {
            email,
            ...profile,
          },
        },
      },
    },
    create: {
      id,
      email,
      password: hashedPassword,
      profile: {
        create: {
          email,
          ...profile,
        },
      },
    },
    include: { profile: true },
  });
}

async function upsertPlan(plan) {
  const { name, ...data } = plan;
  return prisma.plan.upsert({
    where: { name },
    update: data,
    create: { name, ...data },
  });
}

async function upsertPage(page) {
  const { pageKey, ...data } = page;
  return prisma.pageContent.upsert({
    where: { pageKey },
    update: data,
    create: { pageKey, ...data },
  });
}

async function upsertInterpreterApplication(application) {
  const id = application.id || `seed-application-${application.email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const reviewedAt = application.reviewedAt || null;

  await prisma.$executeRaw`
    INSERT INTO interpreter_applications (
      id,
      full_name,
      email,
      phone,
      city,
      country_code,
      bio,
      qualifications,
      experience_years,
      status,
      notes,
      reviewed_at,
      updated_at
    )
    VALUES (
      ${id},
      ${application.fullName},
      ${application.email},
      ${application.phone || null},
      ${application.city},
      ${application.countryCode},
      ${application.bio || null},
      ${application.qualifications || null},
      ${application.experienceYears || 0},
      ${application.status || "pending"},
      ${application.notes || null},
      ${reviewedAt},
      ${new Date()}
    )
    ON DUPLICATE KEY UPDATE
      full_name = VALUES(full_name),
      phone = VALUES(phone),
      city = VALUES(city),
      country_code = VALUES(country_code),
      bio = VALUES(bio),
      qualifications = VALUES(qualifications),
      experience_years = VALUES(experience_years),
      status = VALUES(status),
      notes = VALUES(notes),
      reviewed_at = VALUES(reviewed_at),
      updated_at = VALUES(updated_at)
  `;
}

async function upsertInterpreterMessageTemplate(template) {
  const id = template.id || `seed-template-${template.category}-${template.sortOrder}`;
  return prisma.interpreterMessageTemplate.upsert({
    where: { id },
    update: {
      category: template.category,
      content: template.content,
      sortOrder: template.sortOrder,
      isActive: template.isActive ?? true,
    },
    create: {
      id,
      category: template.category,
      content: template.content,
      sortOrder: template.sortOrder,
      isActive: template.isActive ?? true,
    },
  });
}

async function upsertReview(review) {
  await prisma.$executeRaw`
    INSERT INTO reviews (
      id,
      reviewer_name,
      content,
      rating,
      source,
      is_featured,
      is_published,
      updated_at
    )
    VALUES (
      ${review.id},
      ${review.reviewerName},
      ${review.content},
      ${review.rating || 5},
      ${review.source || null},
      ${Boolean(review.isFeatured)},
      ${review.isPublished !== false},
      ${new Date()}
    )
    ON DUPLICATE KEY UPDATE
      reviewer_name = VALUES(reviewer_name),
      content = VALUES(content),
      rating = VALUES(rating),
      source = VALUES(source),
      is_featured = VALUES(is_featured),
      is_published = VALUES(is_published),
      updated_at = VALUES(updated_at)
  `;
}

async function main() {
  console.log("Starting database seed...");

  console.log("Creating plans...");
  const limitedPlan = await upsertPlan({
    name: "محدود",
    description: "خطة مجانية لرؤية قصيرة حتى 500 حرف",
    price: 0,
    currency: "EGP",
    letterQuota: 500,
    features: ["رؤية واحدة", "حتى 500 حرف", "تفسير معتمد"],
    scope: "egypt",
    countryCodes: [],
    isActive: true,
    supportsVoiceNotes: false,
    voiceNoteMaxSeconds: null,
  });

  const basicPlan = await upsertPlan({
    name: "أساسي",
    description: "خطة أساسية لرؤية متوسطة حتى 1500 حرف",
    price: 50,
    currency: "EGP",
    letterQuota: 1500,
    features: ["رؤية واحدة", "حتى 1500 حرف", "دعم خلال 24 ساعة"],
    scope: "egypt",
    countryCodes: [],
    isActive: true,
    supportsVoiceNotes: true,
    voiceNoteMaxSeconds: 60,
  });

  const proPlan = await upsertPlan({
    name: "احترافي",
    description: "خطة احترافية داخل مصر لرؤية مفصلة حتى 3000 حرف",
    price: 100,
    currency: "EGP",
    letterQuota: 3000,
    features: ["رؤية واحدة", "حتى 3000 حرف", "دعم مخصص", "متابعة مباشرة"],
    scope: "egypt",
    countryCodes: [],
    isActive: true,
    supportsVoiceNotes: true,
    voiceNoteMaxSeconds: 120,
  });

  const premiumPlan = await upsertPlan({
    name: "مميز",
    description: "خطة خارج مصر لرؤية شاملة حتى 5000 حرف",
    price: 12,
    currency: "USD",
    letterQuota: 5000,
    features: ["رؤية واحدة", "حتى 5000 حرف", "دعم مخصص", "متاحة خارج مصر"],
    scope: "international",
    countryCodes: [],
    isActive: true,
    supportsVoiceNotes: true,
    voiceNoteMaxSeconds: 120,
  });

  const internationalBasicPlan = await upsertPlan({
    name: "دولي أساسي",
    description: "خطة خارج مصر لرؤية متوسطة حتى 1500 حرف",
    price: 6,
    currency: "USD",
    letterQuota: 1500,
    features: ["رؤية واحدة", "حتى 1500 حرف", "متاحة خارج مصر"],
    scope: "international",
    countryCodes: [],
    isActive: true,
    supportsVoiceNotes: false,
    voiceNoteMaxSeconds: null,
  });

  const internationalProPlan = await upsertPlan({
    name: "دولي احترافي",
    description: "خطة خارج مصر لرؤية مفصلة حتى 3000 حرف",
    price: 9,
    currency: "USD",
    letterQuota: 3000,
    features: ["رؤية واحدة", "حتى 3000 حرف", "متابعة مباشرة", "متاحة خارج مصر"],
    scope: "international",
    countryCodes: [],
    isActive: true,
    supportsVoiceNotes: true,
    voiceNoteMaxSeconds: 90,
  });

  const archivedPlan = await upsertPlan({
    name: "أرشيفية",
    description: "خطة قديمة غير مفعلة لاختبار حالة التعطيل",
    price: 25,
    currency: "EGP",
    letterQuota: 800,
    features: ["خطة اختبارية", "غير متاحة للمستخدمين"],
    scope: "egypt",
    countryCodes: [],
    isActive: false,
    supportsVoiceNotes: false,
    voiceNoteMaxSeconds: null,
  });

  console.log("Creating interpreter message templates...");
  await Promise.all([
    upsertInterpreterMessageTemplate({
      category: "opening",
      content: "السلام عليكم ورحمة الله وبركاته، شكرًا لك على مشاركة رؤياك. سأقرأ التفاصيل بعناية ثم أبدأ بالرد عليك.",
      sortOrder: 0,
    }),
    upsertInterpreterMessageTemplate({
      category: "opening",
      content: "مرحبًا بك، وصلتني الرؤيا وسأطرح عليك أي سؤال توضيحي إذا احتجت قبل التفسير.",
      sortOrder: 1,
    }),
    upsertInterpreterMessageTemplate({
      category: "general",
      content: "هل يمكنك توضيح هذا الجزء من الرؤيا بمزيد من التفاصيل؟",
      sortOrder: 0,
    }),
    upsertInterpreterMessageTemplate({
      category: "closing",
      content: "هذا ما ظهر لي في تفسير الرؤيا، والله أعلم. إذا احتجت أي توضيح إضافي فأخبرني.",
      sortOrder: 0,
    }),
  ]);

  console.log("Creating users...");
  await upsertUser({
    id: ids.superAdmin,
    email: "admin@mubasharat.com",
    password: "admin123",
    profile: {
      fullName: "مسؤول النظام",
      role: "super_admin",
      city: "Cairo",
      countryCode: "EG",
      isAvailable: true,
    },
  });

  await upsertUser({
    id: ids.regularAdmin,
    email: "regularadmin@mubasharat.com",
    password: "admin123",
    profile: {
      fullName: "مدير عادي",
      role: "admin",
      city: "Cairo",
      countryCode: "EG",
      isAvailable: true,
    },
  });

  await upsertUser({
    id: ids.interpreterAhmed,
    email: "interpreter@mubasharat.com",
    password: "interpreter123",
    profile: {
      fullName: "أحمد المفسر",
      role: "interpreter",
      bio: "مفسر أحلام متخصص بخبرة 10 سنوات",
      city: "Cairo",
      countryCode: "EG",
      isAvailable: true,
      totalInterpretations: 18,
      rating: 4.8,
    },
  });

  await upsertUser({
    id: ids.interpreterMona,
    email: "mona.interpreter@mubasharat.com",
    password: "interpreter123",
    profile: {
      fullName: "منى عبد الرحمن",
      role: "interpreter",
      bio: "متخصصة في تفسير الرؤى الاجتماعية والعائلية",
      city: "Riyadh",
      countryCode: "SA",
      isAvailable: true,
      totalInterpretations: 12,
      rating: 4.6,
    },
  });

  await upsertUser({
    id: ids.interpreterYoussef,
    email: "youssef.interpreter@mubasharat.com",
    password: "interpreter123",
    profile: {
      fullName: "يوسف خالد",
      role: "interpreter",
      bio: "غير متاح حاليا لاختبار حالة التوفر",
      city: "Dubai",
      countryCode: "AE",
      isAvailable: false,
      totalInterpretations: 7,
      rating: 4.2,
    },
  });

  await upsertUser({
    id: ids.dreamerMohamed,
    email: "dreamer@mubasharat.com",
    password: "dreamer123",
    profile: {
      fullName: "محمد الرائي",
      role: "dreamer",
      bio: "أبحث عن تفسير رؤياي",
      city: "Cairo",
      countryCode: "EG",
      isAvailable: true,
      currentPlanId: basicPlan.id,
    },
  });

  await upsertUser({
    id: ids.dreamerSara,
    email: "sara.dreamer@mubasharat.com",
    password: "dreamer123",
    profile: {
      fullName: "سارة محمود",
      role: "dreamer",
      city: "Jeddah",
      countryCode: "SA",
      isAvailable: true,
      currentPlanId: proPlan.id,
    },
  });

  await upsertUser({
    id: ids.dreamerOmar,
    email: "omar.dreamer@mubasharat.com",
    password: "dreamer123",
    profile: {
      fullName: "عمر حسن",
      role: "dreamer",
      city: "Dubai",
      countryCode: "AE",
      isAvailable: true,
    },
  });

  console.log("Creating interpreter applications...");
  const interpreterApplications = [
    {
      fullName: "خالد عبد الله",
      email: "khaled.applicant@mubasharat.com",
      phone: "+201001112233",
      city: "Cairo",
      countryCode: "EG",
      bio: "مهتم بتفسير الرؤى وله خبرة في الإرشاد الأسري.",
      qualifications: "دراسات شرعية ودورات متخصصة في آداب تعبير الرؤى.",
      experienceYears: 5,
      status: "pending",
      notes: "بانتظار مراجعة الشهادات.",
      reviewedAt: null,
    },
    {
      fullName: "نورة السالم",
      email: "noura.applicant@mubasharat.com",
      phone: "+966500000111",
      city: "Riyadh",
      countryCode: "SA",
      bio: "مفسرة رؤى مستقلة ترغب بالانضمام إلى فريق المنصة.",
      qualifications: "خبرة عملية مع مراجعات عملاء ممتازة.",
      experienceYears: 8,
      status: "approved",
      notes: "مناسبة للمرحلة القادمة من التوظيف.",
      reviewedAt: new Date("2026-05-14T10:00:00.000Z"),
    },
    {
      fullName: "سعيد المنصوري",
      email: "saeed.applicant@mubasharat.com",
      phone: "+971500000222",
      city: "Dubai",
      countryCode: "AE",
      bio: "طلب انضمام لاختبار حالة الرفض في لوحة الإدارة.",
      qualifications: "بيانات غير مكتملة.",
      experienceYears: 1,
      status: "rejected",
      notes: "الخبرة غير كافية حالياً.",
      reviewedAt: new Date("2026-05-13T15:30:00.000Z"),
    },
  ];

  for (const application of interpreterApplications) {
    await upsertInterpreterApplication(application);
  }

  console.log("Creating reviews...");
  const reviews = [
    {
      id: "seed-review-maryam",
      reviewerName: "مريم.س",
      content: "جزاكم الله خيراً على المنصة، التفسير كان دقيقاً ومطمئناً جداً.",
      rating: 5,
      source: "app",
      isFeatured: true,
      isPublished: true,
    },
    {
      id: "seed-review-abdullah",
      reviewerName: "عبدالله.م",
      content: "سرعة الرد وجودة التفسير كانت رائعة، شكراً لفريق أحلامي.",
      rating: 5,
      source: "app",
      isFeatured: true,
      isPublished: true,
    },
    {
      id: "seed-review-fatima",
      reviewerName: "فاطمة.أ",
      content: "تعامل محترم وسرعة في الرد، التفسير كان واضحاً ومرتباً وساعدني أفهم رؤياي بشكل أفضل.",
      rating: 5,
      source: "app",
      isFeatured: false,
      isPublished: true,
    },
    {
      id: "seed-review-ahmed",
      reviewerName: "أحمد.م",
      content: "منصة موثوقة ومفيدة، أنصح بها كل من يبحث عن تفسير رؤى وفق المنهج الإسلامي.",
      rating: 5,
      source: "app",
      isFeatured: true,
      isPublished: true,
    },
    {
      id: "seed-review-noura",
      reviewerName: "نورة.خ",
      content: "تجربة ممتازة، المفسرون متعاونون والشرح كان يسيراً على الفهم.",
      rating: 5,
      source: "app",
      isFeatured: false,
      isPublished: true,
    },
  ];

  for (const review of reviews) {
    await upsertReview(review);
  }

  console.log("Creating user plan subscriptions...");
  await prisma.userPlan.upsert({
    where: { userId_planId: { userId: ids.dreamerMohamed, planId: basicPlan.id } },
    update: { isActive: true, lettersUsed: 420, audioMinutesUsed: 2 },
    create: {
      id: "seed-user-plan-mohamed",
      userId: ids.dreamerMohamed,
      planId: basicPlan.id,
      isActive: true,
      lettersUsed: 420,
      audioMinutesUsed: 2,
    },
  });

  await prisma.userPlan.upsert({
    where: { userId_planId: { userId: ids.dreamerSara, planId: proPlan.id } },
    update: { isActive: true, lettersUsed: 980, audioMinutesUsed: 0 },
    create: {
      id: "seed-user-plan-sara",
      userId: ids.dreamerSara,
      planId: proPlan.id,
      isActive: true,
      lettersUsed: 980,
      audioMinutesUsed: 0,
    },
  });

  console.log("Creating dreams...");
  const dreams = [
    {
      id: ids.dreamWedding,
      dreamerId: ids.dreamerMohamed,
      interpreterId: ids.interpreterAhmed,
      planId: basicPlan.id,
      title: "رؤيا حفل زفاف",
      content: "رأيت أنني في حفل زفاف كبير وكانت الأنوار هادئة والناس مبتسمين.",
      description: "رأيت أنني في حفل زفاف كبير وكانت الأنوار هادئة والناس مبتسمين.",
      status: "interpreted",
      interpretation: "الرؤيا تحمل بشارة بتيسير أمر اجتماعي أو عائلي بإذن الله.",
      dreamDate: new Date("2026-05-01T10:00:00.000Z"),
      mood: "happy",
      metadata: { source: "seed", type: "social" },
      isSatisfied: true,
      satisfiedAt: new Date("2026-05-04T12:00:00.000Z"),
    },
    {
      id: ids.dreamSea,
      dreamerId: ids.dreamerSara,
      interpreterId: ids.interpreterMona,
      planId: proPlan.id,
      title: "رؤيا البحر الهادئ",
      content: "رأيت بحرا هادئا وكنت أمشي على الشاطئ بدون خوف.",
      description: "رأيت بحرا هادئا وكنت أمشي على الشاطئ بدون خوف.",
      status: "pending_interpretation",
      dreamDate: new Date("2026-05-06T09:00:00.000Z"),
      mood: "calm",
      metadata: { source: "seed", type: "travel" },
    },
    {
      id: ids.dreamKeys,
      dreamerId: ids.dreamerOmar,
      interpreterId: null,
      planId: premiumPlan.id,
      title: "رؤيا مفاتيح كثيرة",
      content: "وجدت مفاتيح كثيرة على طاولة واخترت مفتاحا ذهبيا.",
      description: "وجدت مفاتيح كثيرة على طاولة واخترت مفتاحا ذهبيا.",
      status: "new",
      dreamDate: new Date("2026-05-10T07:00:00.000Z"),
      mood: "curious",
      metadata: { source: "seed", type: "opportunity" },
    },
    {
      id: ids.dreamTravel,
      dreamerId: ids.dreamerMohamed,
      interpreterId: ids.interpreterYoussef,
      planId: null,
      title: "رؤيا سفر مؤجل",
      content: "كنت في المطار لكن الرحلة تأخرت ثم عدت إلى المنزل.",
      description: "كنت في المطار لكن الرحلة تأخرت ثم عدت إلى المنزل.",
      status: "returned",
      dreamDate: new Date("2026-05-11T14:00:00.000Z"),
      mood: "anxious",
      metadata: { source: "seed", type: "travel" },
    },
    {
      id: ids.dreamLight,
      dreamerId: ids.dreamerSara,
      interpreterId: null,
      planId: null,
      title: "رؤيا نور في البيت",
      content: "دخل نور قوي إلى البيت ثم شعرت بالطمأنينة.",
      description: "دخل نور قوي إلى البيت ثم شعرت بالطمأنينة.",
      status: "pending_payment",
      dreamDate: new Date("2026-05-12T20:00:00.000Z"),
      mood: "peaceful",
      metadata: { source: "seed", type: "family" },
    },
  ];

  for (const dream of dreams) {
    const { id, ...data } = dream;
    await prisma.dream.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  await prisma.$executeRaw`
    UPDATE dreams
    SET is_featured = true, featured_at = COALESCE(featured_at, ${new Date("2026-05-15T12:00:00.000Z")})
    WHERE id IN (${ids.dreamWedding}, ${ids.dreamSea}, ${ids.dreamKeys})
  `;

  await prisma.$executeRaw`
    UPDATE dreams
    SET is_featured = false, featured_at = NULL
    WHERE id IN (${ids.dreamTravel}, ${ids.dreamLight})
  `;

  console.log("Creating payments and dream purchases...");
  const payments = [
    {
      id: ids.paymentWedding,
      userId: ids.dreamerMohamed,
      planId: basicPlan.id,
      dreamId: ids.dreamWedding,
      amount: 50,
      currency: "EGP",
      status: "succeeded",
      provider: "stripe",
      reference: "cs_seed_wedding",
      paidAt: new Date("2026-05-02T10:00:00.000Z"),
      metadata: { purchaseType: "dream", source: "seed" },
    },
    {
      id: ids.paymentSea,
      userId: ids.dreamerSara,
      planId: proPlan.id,
      dreamId: ids.dreamSea,
      amount: 100,
      currency: "EGP",
      status: "succeeded",
      provider: "stripe",
      reference: "cs_seed_sea",
      paidAt: new Date("2026-05-06T10:00:00.000Z"),
      metadata: { purchaseType: "dream", source: "seed" },
    },
    {
      id: ids.paymentFailed,
      userId: ids.dreamerSara,
      planId: limitedPlan.id,
      dreamId: ids.dreamLight,
      amount: 0,
      currency: "EGP",
      status: "failed",
      provider: "stripe",
      reference: "cs_seed_failed",
      paidAt: null,
      metadata: { purchaseType: "dream", source: "seed", reason: "card_declined" },
    },
  ];

  for (const payment of payments) {
    const { id, ...data } = payment;
    await prisma.payment.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  await prisma.dreamPlanPurchase.upsert({
    where: { dreamId: ids.dreamWedding },
    update: {
      planId: basicPlan.id,
      paymentId: ids.paymentWedding,
      letterQuota: basicPlan.letterQuota,
      lettersUsed: 420,
    },
    create: {
      id: "seed-purchase-wedding",
      dreamId: ids.dreamWedding,
      planId: basicPlan.id,
      paymentId: ids.paymentWedding,
      letterQuota: basicPlan.letterQuota,
      lettersUsed: 420,
    },
  });

  await prisma.dreamPlanPurchase.upsert({
    where: { dreamId: ids.dreamSea },
    update: {
      planId: proPlan.id,
      paymentId: ids.paymentSea,
      letterQuota: proPlan.letterQuota,
      lettersUsed: 980,
    },
    create: {
      id: "seed-purchase-sea",
      dreamId: ids.dreamSea,
      planId: proPlan.id,
      paymentId: ids.paymentSea,
      letterQuota: proPlan.letterQuota,
      lettersUsed: 980,
    },
  });

  console.log("Creating requests and chat messages...");
  const requests = [
    {
      id: ids.requestWedding,
      dreamId: ids.dreamWedding,
      dreamerId: ids.dreamerMohamed,
      interpreterId: ids.interpreterAhmed,
      status: "completed",
      title: "متابعة تفسير رؤيا الزفاف",
      description: "أريد توضيح معنى وجود الأنوار في الرؤيا.",
      budget: 50,
      completedAt: new Date("2026-05-04T12:30:00.000Z"),
    },
    {
      id: ids.requestSea,
      dreamId: ids.dreamSea,
      dreamerId: ids.dreamerSara,
      interpreterId: ids.interpreterMona,
      status: "in_progress",
      title: "طلب تفسير رؤيا البحر",
      description: "هل البحر الهادئ يدل على سفر قريب؟",
      budget: 100,
      completedAt: null,
    },
    {
      id: ids.requestKeys,
      dreamId: ids.dreamKeys,
      dreamerId: ids.dreamerOmar,
      interpreterId: null,
      status: "open",
      title: "طلب تفسير المفاتيح",
      description: "الرؤيا بانتظار إسناد مفسر من لوحة الإدارة.",
      budget: 200,
      completedAt: null,
    },
  ];

  for (const request of requests) {
    const { id, ...data } = request;
    await prisma.request.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  const chatMessages = [
    {
      id: "seed-chat-wedding-1",
      requestId: ids.requestWedding,
      senderId: ids.dreamerMohamed,
      content: "هل وجود الأنوار له دلالة خاصة؟",
      messageType: "text",
      isRead: true,
    },
    {
      id: "seed-chat-wedding-2",
      requestId: ids.requestWedding,
      senderId: ids.interpreterAhmed,
      content: "غالبا يدل على وضوح وتيسير في الأمر بإذن الله.",
      messageType: "interpretation",
      isRead: true,
    },
    {
      id: "seed-chat-sea-1",
      requestId: ids.requestSea,
      senderId: ids.dreamerSara,
      content: "أشعر أن الرؤيا مرتبطة بقرار سفر.",
      messageType: "text",
      isRead: false,
    },
  ];

  for (const message of chatMessages) {
    const { id, ...data } = message;
    await prisma.chatMessage.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  console.log("Creating dream messages and comments...");
  const messages = [
    {
      id: "seed-message-wedding-1",
      dreamId: ids.dreamWedding,
      senderId: ids.interpreterAhmed,
      content: "التفسير الأولي للرؤيا يشير إلى بشارة قريبة.",
      messageType: "interpretation",
    },
    {
      id: "seed-message-sea-1",
      dreamId: ids.dreamSea,
      senderId: ids.dreamerSara,
      content: "أرجو توضيح معنى البحر الهادئ.",
      messageType: "inquiry",
    },
  ];

  for (const message of messages) {
    const { id, ...data } = message;
    await prisma.message.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  await prisma.comment.upsert({
    where: { id: "seed-comment-wedding" },
    update: {
      dreamId: ids.dreamWedding,
      userId: ids.regularAdmin,
      content: "تمت مراجعة التفسير من الإدارة.",
    },
    create: {
      id: "seed-comment-wedding",
      dreamId: ids.dreamWedding,
      userId: ids.regularAdmin,
      content: "تمت مراجعة التفسير من الإدارة.",
    },
  });

  console.log("Creating content pages...");
  const pages = [
    {
      pageKey: "about",
      title: "عن مبشرات",
      content: "<h1>عن مبشرات</h1><p>منصة متخصصة في استقبال الرؤى وربطها بالمفسرين المعتمدين.</p>",
      metadata: { seoDescription: "تعرف على منصة مبشرات" },
      isPublished: true,
    },
    {
      pageKey: "terms",
      title: "الشروط والأحكام",
      content: "<h1>الشروط والأحكام</h1><p>باستخدامك للمنصة فإنك توافق على شروط الاستخدام وسياسة الدفع.</p>",
      metadata: { seoDescription: "شروط استخدام منصة مبشرات" },
      isPublished: true,
    },
    {
      pageKey: "guide",
      title: "دليل الاستخدام",
      content: "<h1>دليل الاستخدام</h1><p>أرسل رؤياك، اختر الخطة المناسبة، ثم تابع الرد من المفسر.</p>",
      metadata: { seoDescription: "دليل استخدام المنصة" },
      isPublished: true,
    },
    {
      pageKey: "faqs",
      title: "الأسئلة الشائعة",
      content: "<h1>الأسئلة الشائعة</h1><h2>كيف أرسل رؤيا جديدة؟</h2><p>سجل الدخول، اختر الخطة المناسبة، ثم اكتب تفاصيل الرؤيا بوضوح من داخل التطبيق.</p><h2>متى يصلني التفسير؟</h2><p>يمكنك متابعة حالة الطلب داخل التطبيق، وسيصلك إشعار عند اكتمال التفسير.</p><h2>هل يمكنني التواصل مع المفسر؟</h2><p>نعم، تظهر المحادثة الخاصة بالرؤيا عند الحاجة إلى استفسار أو توضيح.</p>",
      metadata: { seoDescription: "الأسئلة الشائعة حول استخدام أحلامي" },
      isPublished: true,
    },
    {
      pageKey: "support",
      title: "الدعم والمساعدة",
      content: "<h1>الدعم والمساعدة</h1><p>يمكنك التواصل مع فريق الدعم بخصوص الحسابات أو المدفوعات أو الطلبات.</p>",
      metadata: { seoDescription: "دعم ومساعدة مبشرات" },
      isPublished: true,
    },
    {
      pageKey: "good-news",
      title: "البشارات",
      content: "<h1>البشارات</h1><p>مساحة تعريفية بمعنى الرؤيا الصالحة والبشارة.</p>",
      metadata: { seoDescription: "البشارات في الرؤى" },
      isPublished: true,
    },
    {
      pageKey: "join",
      title: "انضم كمفسر",
      content: "<h1>انضم كمفسر</h1><p>نرحب بالمفسرين المؤهلين للانضمام إلى فريق المنصة.</p>",
      metadata: { seoDescription: "انضم إلى مبشرات كمفسر" },
      isPublished: false,
    },
    {
      pageKey: "rate",
      title: "تقييم الخدمة",
      content: "<h1>تقييم الخدمة</h1><p>رأيك يساعدنا على تحسين تجربة تفسير الرؤى.</p>",
      metadata: { seoDescription: "تقييم خدمة مبشرات" },
      isPublished: true,
    },
  ];

  for (const page of pages) {
    await upsertPage(page);
  }

  console.log("Creating notifications and admin logs...");
  const notifications = [
    {
      id: "seed-notification-admin-new-dream",
      userId: ids.regularAdmin,
      type: "dream_submitted",
      message: "تم إرسال رؤيا جديدة بانتظار الإسناد",
      isRead: false,
      referenceId: ids.dreamKeys,
    },
    {
      id: "seed-notification-interpreter-assigned",
      userId: ids.interpreterMona,
      type: "request_assigned",
      message: "تم إسناد طلب تفسير جديد إليك",
      isRead: false,
      referenceId: ids.requestSea,
    },
    {
      id: "seed-notification-dreamer-status",
      userId: ids.dreamerMohamed,
      type: "dream_status_changed",
      message: "تم اكتمال تفسير رؤيا الزفاف",
      isRead: true,
      referenceId: ids.dreamWedding,
    },
  ];

  for (const notification of notifications) {
    const { id, ...data } = notification;
    await prisma.notification.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  const logs = [
    {
      id: "seed-admin-log-assign",
      adminId: ids.regularAdmin,
      action: "assign_dream",
      targetType: "dream",
      targetId: ids.dreamSea,
      details: { interpreterId: ids.interpreterMona },
    },
    {
      id: "seed-admin-log-content",
      adminId: ids.superAdmin,
      action: "update_content_page",
      targetType: "page_content",
      targetId: "about",
      details: { pageKey: "about" },
    },
  ];

  for (const log of logs) {
    const { id, ...data } = log;
    await prisma.adminLog.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  console.log("\nDatabase seed completed successfully.");
  console.log("\nTest accounts:");
  console.log("  Super Admin: admin@mubasharat.com / admin123");
  console.log("  Regular Admin: regularadmin@mubasharat.com / admin123");
  console.log("  Interpreter: interpreter@mubasharat.com / interpreter123");
  console.log("  Interpreter: mona.interpreter@mubasharat.com / interpreter123");
  console.log("  Dreamer: dreamer@mubasharat.com / dreamer123");
  console.log("  Dreamer: sara.dreamer@mubasharat.com / dreamer123");
  console.log("  Dreamer: omar.dreamer@mubasharat.com / dreamer123");
}

main()
  .catch((error) => {
    console.error("Error seeding database:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
