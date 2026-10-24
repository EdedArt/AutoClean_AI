const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Clear existing data in relational order to prevent FK constraints issues
  await prisma.evidence.deleteMany();
  await prisma.serviceOrder.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.package.deleteMany();
  await prisma.bay.deleteMany();

  // 2. Create 4 Bays
  const bay1 = await prisma.bay.create({
    data: { numero: 1, ocupada: true },
  });
  const bay2 = await prisma.bay.create({
    data: { numero: 2, ocupada: true },
  });
  await prisma.bay.create({
    data: { numero: 3, ocupada: false },
  });
  await prisma.bay.create({
    data: { numero: 4, ocupada: false },
  });

  // 3. Create 2 Packages
  const pkgBasico = await prisma.package.create({
    data: {
      nombre: 'Lavado Básico',
      descripcion: 'Lavado exterior y aspirado rápido',
      precio: 25.0,
    },
  });

  const pkgProfundo = await prisma.package.create({
    data: {
      nombre: 'Lavado Profundo + Polichado',
      descripcion: 'Lavado exterior, interior, desinfección y polichado',
      precio: 55.0,
    },
  });

  // 4. Create Vehicles (at least 8 vehicles for demoing search and pagination)
  const vehicle1 = await prisma.vehicle.create({
    data: {
      placa: 'XYZ-123',
      marca: 'Mazda',
      modelo: 'CX-5',
      nivelSuciedad: 'Severo',
    },
  });

  const vehicle2 = await prisma.vehicle.create({
    data: {
      placa: 'ABC-987',
      marca: 'Toyota',
      modelo: 'Corolla',
      nivelSuciedad: 'Leve',
    },
  });

  const vehicle3 = await prisma.vehicle.create({
    data: {
      placa: 'DEF-456',
      marca: 'Chevrolet',
      modelo: 'Tracker',
      nivelSuciedad: 'Moderado',
    },
  });

  const vehicle4 = await prisma.vehicle.create({
    data: {
      placa: 'GHI-789',
      marca: 'Nissan',
      modelo: 'Kicks',
      nivelSuciedad: 'Leve',
    },
  });

  const vehicle5 = await prisma.vehicle.create({
    data: {
      placa: 'JKL-012',
      marca: 'Renault',
      modelo: 'Duster',
      nivelSuciedad: 'Severo',
    },
  });

  const vehicle6 = await prisma.vehicle.create({
    data: {
      placa: 'MNO-345',
      marca: 'Kia',
      modelo: 'Sportage',
      nivelSuciedad: 'Moderado',
    },
  });

  const vehicle7 = await prisma.vehicle.create({
    data: {
      placa: 'PQR-678',
      marca: 'Ford',
      modelo: 'Escape',
      nivelSuciedad: 'Leve',
    },
  });

  const vehicle8 = await prisma.vehicle.create({
    data: {
      placa: 'STU-901',
      marca: 'Volkswagen',
      modelo: 'Tiguan',
      nivelSuciedad: 'Severo',
    },
  });

  // 5. Create Service Orders across different phases (RECIBIDO, LAVADO, SECADO, LISTO)
  await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle1.id,
      packageId: pkgProfundo.id,
      bayId: bay1.id,
      faseActual: 'LAVADO',
      porcentajeProgreso: 45,
    },
  });

  await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle2.id,
      packageId: pkgBasico.id,
      bayId: bay2.id,
      faseActual: 'SECADO',
      porcentajeProgreso: 80,
    },
  });

  await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle3.id,
      packageId: pkgBasico.id,
      bayId: null,
      faseActual: 'RECIBIDO',
      porcentajeProgreso: 10,
    },
  });

  await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle4.id,
      packageId: pkgProfundo.id,
      bayId: null,
      faseActual: 'LISTO',
      porcentajeProgreso: 100,
    },
  });

  await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle5.id,
      packageId: pkgBasico.id,
      bayId: null,
      faseActual: 'RECIBIDO',
      porcentajeProgreso: 10,
    },
  });

  // 6. Seed demo users (idempotent upsert)
  const demoPassword = 'Demo12345!';
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  await prisma.user.upsert({
    where: { email: 'operario@autoclean.com' },
    update: {
      passwordHash,
      nombre: 'Operario Demo',
      rol: 'OPERARIO',
    },
    create: {
      email: 'operario@autoclean.com',
      passwordHash,
      nombre: 'Operario Demo',
      rol: 'OPERARIO',
    },
  });

  await prisma.user.upsert({
    where: { email: 'cliente@autoclean.com' },
    update: {
      passwordHash,
      nombre: 'Cliente Demo',
      rol: 'CLIENTE',
    },
    create: {
      email: 'cliente@autoclean.com',
      passwordHash,
      nombre: 'Cliente Demo',
      rol: 'CLIENTE',
    },
  });

  console.log('\n👤 Demo Users seeded successfully:');
  console.log(`   - Operario: operario@autoclean.com / ${demoPassword} (Role: OPERARIO)`);
  console.log(`   - Cliente:  cliente@autoclean.com / ${demoPassword} (Role: CLIENTE)`);
  console.log('   ⚠️  NOTE: Demo credentials are for testing and demonstration ONLY.\n');

  console.log('✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
