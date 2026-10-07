const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Clear existing data in relational order to prevent FK constraints issues
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

  // 4. Create 2 Vehicles
  const vehicle1 = await prisma.vehicle.create({
    data: {
      placa: 'XYZ-123',
      marca: 'Mazda',
      modelo: 'CX-5',
      nivelSuciedad: 'Alto',
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

  // 5. Create 2 Service Orders
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
