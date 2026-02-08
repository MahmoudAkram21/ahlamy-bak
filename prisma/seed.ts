import prisma from "../src/lib/prisma";
import bcrypt from "bcryptjs";
/**
 * Prisma Database Seed Script
 *
 * This script populates the database with initial data including:
 * - Default plans
 * - Test users (optional)
 *
 * Run with: npm run prisma:seed
 */

async function main() {
  console.log("🌱 Starting database seed...");

  // Create default plans
  console.log("📋 Creating default plans...");

  const plans = [
    {
      name: "محدود",
      description: "خطة محدودة لرؤية قصيرة - حتى 500 حرف",
      price: 0,
      currency: "EGP",
      letterQuota: 500,
      features: [
        "رؤية واحدة",
        "حتى 500 حرف",
        "تفسير معتمد",
        "دعم البريد الإلكتروني",
      ],
      isActive: true,
    },
    {
      name: "أساسي",
      description: "خطة أساسية لرؤية متوسطة - حتى 1500 حرف",
      price: 50,
      currency: "EGP",
      letterQuota: 1500,
      features: [
        "رؤية واحدة",
        "حتى 1500 حرف",
        "تفسير معتمد",
        "دعم خلال 24 ساعة",
      ],
      isActive: true,
    },
    {
      name: "احترافي",
      description: "خطة احترافية لرؤية مفصلة - حتى 3000 حرف",
      price: 100,
      currency: "EGP",
      letterQuota: 3000,
      features: [
        "رؤية واحدة",
        "حتى 3000 حرف",
        "تفسير معتمد",
        "دعم مخصص",
        "متابعة مباشرة",
      ],
      isActive: true,
    },
    {
      name: "مميز",
      description: "خطة مميزة لرؤية شاملة - حتى 5000 حرف",
      price: 200,
      currency: "EGP",
      letterQuota: 5000,
      features: [
        "رؤية واحدة",
        "حتى 5000 حرف",
        "تفسير معتمد",
        "دعم 24/7",
        "متابعة مباشرة",
        "تحليل متقدم",
      ],
      isActive: true,
    },
  ];

  for (const plan of plans) {
    const { name, ...planData } = plan;
    await prisma.plan.upsert({
      where: { name },
      update: planData,
      create: {
        name,
        description: planData.description,
        price: planData.price,
        currency: planData.currency,
        letterQuota: planData.letterQuota,
        features: planData.features,
        isActive: planData.isActive,
      },
    });
    console.log(
      `✅ Created plan: ${plan.name} - ${plan.letterQuota} letters - ${plan.price} ${plan.currency}`
    );
  }

  // Create test admin user (optional - comment out in production)
  console.log("👤 Creating test admin user...");

  const adminEmail = "admin@mubasharat.com";
  const adminPassword = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: adminPassword,
      profile: {
        create: {
          email: adminEmail,
          fullName: "مسؤول النظام",
          role: "super_admin",
        },
      },
    },
    include: {
      profile: true,
    },
  });

  console.log(`✅ Created admin user: ${adminEmail}`);
  console.log(`   Password: admin123 (please change in production!)`);

  // Create test regular admin user (optional)
  console.log("👤 Creating test regular admin...");

  const regularAdminEmail = "regularadmin@mubasharat.com";
  const regularAdminPassword = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: regularAdminEmail },
    update: {},
    create: {
      email: regularAdminEmail,
      password: regularAdminPassword,
      profile: {
        create: {
          email: regularAdminEmail,
          fullName: "مدير عادي",
          role: "admin",
        },
      },
    },
  });

  console.log(`✅ Created regular admin: ${regularAdminEmail}`);
  console.log(`   Password: admin123`);

  // Create test interpreter (optional)
  console.log("👤 Creating test interpreter...");

  const interpreterEmail = "interpreter@mubasharat.com";
  const interpreterPassword = await bcrypt.hash("interpreter123", 10);

  await prisma.user.upsert({
    where: { email: interpreterEmail },
    update: {},
    create: {
      email: interpreterEmail,
      password: interpreterPassword,
      profile: {
        create: {
          email: interpreterEmail,
          fullName: "أحمد المفسر",
          role: "interpreter",
          bio: "مفسر أحلام متخصص بخبرة 10 سنوات",
          isAvailable: true,
        },
      },
    },
  });

  console.log(`✅ Created interpreter: ${interpreterEmail}`);
  console.log(`   Password: interpreter123`);

  // Create test dreamer (optional)
  console.log("👤 Creating test dreamer...");

  const dreamerEmail = "dreamer@mubasharat.com";
  const dreamerPassword = await bcrypt.hash("dreamer123", 10);

  await prisma.user.upsert({
    where: { email: dreamerEmail },
    update: {},
    create: {
      email: dreamerEmail,
      password: dreamerPassword,
      profile: {
        create: {
          email: dreamerEmail,
          fullName: "محمد الرائي",
          role: "dreamer",
          bio: "أبحث عن تفسير رؤيتي",
        },
      },
    },
  });

  console.log(`✅ Created dreamer: ${dreamerEmail}`);
  console.log(`   Password: dreamer123`);

  console.log("\n✨ Database seed completed successfully!");
  console.log("\n📝 Test accounts:");
  console.log("   Super Admin: admin@mubasharat.com / admin123");
  console.log("   Regular Admin: regularadmin@mubasharat.com / admin123");
  console.log("   Interpreter: interpreter@mubasharat.com / interpreter123");
  console.log("   Dreamer: dreamer@mubasharat.com / dreamer123");
  console.log("\n⚠️  Remember to change passwords in production!");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
