const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Clear existing data in relational order to prevent FK constraints issues
  await prisma.evidence.deleteMany();
  await prisma.phaseEvent.deleteMany();
  await prisma.serviceOrder.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.package.deleteMany();
  await prisma.bay.deleteMany();

  // 2. Seed demo users (idempotent upsert)
  const demoPassword = 'Demo12345!';
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  const operarioUser = await prisma.user.upsert({
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

  const clienteUser = await prisma.user.upsert({
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

  // 3. Create 4 Bays with status matching real active orders
  const bay1 = await prisma.bay.create({
    data: { numero: 1, ocupada: true },
  });
  const bay2 = await prisma.bay.create({
    data: { numero: 2, ocupada: true },
  });
  const bay3 = await prisma.bay.create({
    data: { numero: 3, ocupada: true },
  });
  await prisma.bay.create({
    data: { numero: 4, ocupada: false },
  });

  // 4. Create 2 Packages
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

  // 5. Create Vehicles with color, ownerName and link XYZ-123 to client user
  const vehicle1 = await prisma.vehicle.create({
    data: {
      placa: 'XYZ-123',
      marca: 'Mazda',
      modelo: 'CX-50',
      color: 'Rojo',
      ownerName: 'Edgar Arteaga',
      ownerId: clienteUser.id,
      nivelSuciedad: 'Severo',
    },
  });

  const vehicle2 = await prisma.vehicle.create({
    data: {
      placa: 'ABC-987',
      marca: 'Toyota',
      modelo: 'Corolla',
      color: 'Blanco',
      ownerName: 'Carlos Gómez',
      nivelSuciedad: 'Leve',
    },
  });

  const vehicle3 = await prisma.vehicle.create({
    data: {
      placa: 'DEF-456',
      marca: 'Chevrolet',
      modelo: 'Tracker',
      color: 'Gris',
      ownerName: 'María Rodríguez',
      nivelSuciedad: 'Moderado',
    },
  });

  const vehicle4 = await prisma.vehicle.create({
    data: {
      placa: 'GHI-789',
      marca: 'Nissan',
      modelo: 'Kicks',
      color: 'Azul',
      ownerName: 'Juan Pérez',
      nivelSuciedad: 'Leve',
    },
  });

  const vehicle5 = await prisma.vehicle.create({
    data: {
      placa: 'JKL-012',
      marca: 'Renault',
      modelo: 'Duster',
      color: 'Plata',
      ownerName: 'Ana Martínez',
      nivelSuciedad: 'Severo',
    },
  });

  await prisma.vehicle.create({
    data: {
      placa: 'MNO-345',
      marca: 'Kia',
      modelo: 'Sportage',
      color: 'Negro',
      ownerName: 'David López',
      nivelSuciedad: 'Moderado',
    },
  });

  await prisma.vehicle.create({
    data: {
      placa: 'PQR-678',
      marca: 'Ford',
      modelo: 'Escape',
      color: 'Rojo',
      ownerName: 'Laura Morales',
      nivelSuciedad: 'Leve',
    },
  });

  await prisma.vehicle.create({
    data: {
      placa: 'STU-901',
      marca: 'Volkswagen',
      modelo: 'Tiguan',
      color: 'Blanco',
      ownerName: 'Andrés Castro',
      nivelSuciedad: 'Severo',
    },
  });

  // 6. Create Service Orders covering all new phases (PENDIENTE, REMOJO, LAVADO, SECADO, LISTO)
  // Order 1: LAVADO (55%), in bay 1
  const order1 = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle1.id,
      packageId: pkgProfundo.id,
      bayId: bay1.id,
      faseActual: 'LAVADO',
      porcentajeProgreso: 55,
      listoParaLavar: true,
      readyAt: new Date(Date.now() - 15 * 60 * 1000),
    },
  });
  await prisma.phaseEvent.createMany({
    data: [
      { orderId: order1.id, fase: 'PENDIENTE', progreso: 10, source: 'MANUAL', createdAt: new Date(Date.now() - 20 * 60 * 1000) },
      { orderId: order1.id, fase: 'REMOJO', progreso: 30, source: 'SIMULATION', createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      { orderId: order1.id, fase: 'LAVADO', progreso: 55, source: 'SIMULATION', createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    ],
  });

  // Order 2: SECADO (80%), in bay 2
  const order2 = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle2.id,
      packageId: pkgBasico.id,
      bayId: bay2.id,
      faseActual: 'SECADO',
      porcentajeProgreso: 80,
      listoParaLavar: true,
      readyAt: new Date(Date.now() - 25 * 60 * 1000),
    },
  });
  await prisma.phaseEvent.createMany({
    data: [
      { orderId: order2.id, fase: 'PENDIENTE', progreso: 10, source: 'MANUAL', createdAt: new Date(Date.now() - 30 * 60 * 1000) },
      { orderId: order2.id, fase: 'REMOJO', progreso: 30, source: 'SIMULATION', createdAt: new Date(Date.now() - 20 * 60 * 1000) },
      { orderId: order2.id, fase: 'LAVADO', progreso: 55, source: 'SIMULATION', createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      { orderId: order2.id, fase: 'SECADO', progreso: 80, source: 'SIMULATION', createdAt: new Date(Date.now() - 1 * 60 * 1000) },
    ],
  });

  // Order 3: REMOJO (30%), in bay 3
  const order3 = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle3.id,
      packageId: pkgBasico.id,
      bayId: bay3.id,
      faseActual: 'REMOJO',
      porcentajeProgreso: 30,
      listoParaLavar: true,
      readyAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  });
  await prisma.phaseEvent.createMany({
    data: [
      { orderId: order3.id, fase: 'PENDIENTE', progreso: 10, source: 'MANUAL', createdAt: new Date(Date.now() - 8 * 60 * 1000) },
      { orderId: order3.id, fase: 'REMOJO', progreso: 30, source: 'SIMULATION', createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    ],
  });

  // Order 4: LISTO (100%), bay released (null)
  const order4 = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle4.id,
      packageId: pkgProfundo.id,
      bayId: null,
      faseActual: 'LISTO',
      porcentajeProgreso: 100,
      listoParaLavar: true,
      readyAt: new Date(Date.now() - 40 * 60 * 1000),
    },
  });
  await prisma.phaseEvent.createMany({
    data: [
      { orderId: order4.id, fase: 'PENDIENTE', progreso: 10, source: 'MANUAL', createdAt: new Date(Date.now() - 45 * 60 * 1000) },
      { orderId: order4.id, fase: 'REMOJO', progreso: 30, source: 'SIMULATION', createdAt: new Date(Date.now() - 35 * 60 * 1000) },
      { orderId: order4.id, fase: 'LAVADO', progreso: 55, source: 'SIMULATION', createdAt: new Date(Date.now() - 25 * 60 * 1000) },
      { orderId: order4.id, fase: 'SECADO', progreso: 80, source: 'SIMULATION', createdAt: new Date(Date.now() - 15 * 60 * 1000) },
      { orderId: order4.id, fase: 'LISTO', progreso: 100, source: 'SIMULATION', createdAt: new Date(Date.now() - 5 * 60 * 1000) },
    ],
  });

  // Order 5: PENDIENTE (10%), not ready, waiting in queue (bay null)
  const order5 = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle5.id,
      packageId: pkgBasico.id,
      bayId: null,
      faseActual: 'PENDIENTE',
      porcentajeProgreso: 10,
      listoParaLavar: false,
      readyAt: null,
    },
  });
  await prisma.phaseEvent.create({
    data: {
      orderId: order5.id,
      fase: 'PENDIENTE',
      progreso: 10,
      source: 'MANUAL',
      createdAt: new Date(),
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
