const bcrypt = require('bcryptjs');

/**
 * Idempotently seeds the database with initial demo users, wash bays, and wash packages.
 * Only creates missing records; never deletes or duplicates data.
 * Does NOT seed vehicles or service orders (those are created by clients/operators).
 *
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 */
async function seedDatabase(prismaClient) {
  // Shared client: same PostgreSQL connection settings and test-database guard as the app
  const prisma = prismaClient || require('../src/config/db');
  const shouldDisconnect = !prismaClient;

  try {
    console.log('🌱 Starting idempotent database seeding...');

    // 1. Seed demo users (idempotent upsert)
    const demoPassword = 'Demo12345!';
    const passwordHash = await bcrypt.hash(demoPassword, 10);

    await prisma.user.upsert({
      where: { email: 'operario@autoclean.com' },
      update: {},
      create: {
        email: 'operario@autoclean.com',
        passwordHash,
        nombre: 'Operario Demo',
        rol: 'OPERARIO',
      },
    });

    await prisma.user.upsert({
      where: { email: 'cliente@autoclean.com' },
      update: {},
      create: {
        email: 'cliente@autoclean.com',
        passwordHash,
        nombre: 'Cliente Demo',
        rol: 'CLIENTE',
      },
    });

    // 2. Seed Wash Bays (1 to 4) - create only if missing
    const baysToSeed = [1, 2, 3, 4];
    for (const numero of baysToSeed) {
      await prisma.bay.upsert({
        where: { numero },
        update: {},
        create: {
          numero,
          ocupada: false,
        },
      });
    }

    // 3. Seed Wash Packages - upsert by the stable, unique `codigo`
    const packagesToSeed = [
      {
        codigo: 'BASICO',
        nombre: 'Lavado Básico',
        descripcion: 'Lavado exterior y aspirado rápido',
        precio: 25.0,
        incluyePolichado: false,
      },
      {
        codigo: 'PROFUNDO_POLICHADO',
        nombre: 'Lavado Profundo + Polichado',
        descripcion: 'Lavado exterior, interior, desinfección y polichado',
        precio: 55.0,
        incluyePolichado: true,
      },
    ];

    for (const pkg of packagesToSeed) {
      // Claim a legacy row created before `codigo` existed (same name, no code) so the
      // upsert below updates it instead of creating a duplicate. No-op once claimed.
      await prisma.package.updateMany({
        where: { codigo: null, nombre: pkg.nombre },
        data: { codigo: pkg.codigo },
      });

      // Never overwrite name/description/price on restarts; only keep the polichado flag in sync.
      await prisma.package.upsert({
        where: { codigo: pkg.codigo },
        update: { incluyePolichado: pkg.incluyePolichado },
        create: pkg,
      });
    }

    console.log('👤 Demo accounts ensured: operario@autoclean.com, cliente@autoclean.com');
    console.log('🚿 Wash bays (1-4) and packages ensured.');
    console.log('✅ Idempotent database seeding completed successfully!');
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  seedDatabase()
    .catch((e) => {
      console.error('❌ Seeding failed:', e);
      process.exit(1);
    });
}

module.exports = { seedDatabase };
