/**
 * Fixture helpers that keep the suites idempotent against a persistent database.
 *
 * The test database (a Neon branch) is never reset between runs, so a fixture must not
 * assume a unique key (Vehicle.placa, Bay.numero, User.email, Package.codigo) is free:
 * rows left behind by an earlier crashed or interrupted run would make a plain `create`
 * fail with P2002 on the next run.
 */

/**
 * Returns a plate in the API format `XXX-123` that no vehicle currently uses.
 * Replaces `${prefix}-${random 3 digits}`, which only has 900 values per prefix and can
 * collide with leftover rows or with another plate generated in the same run.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} prefix Three uppercase letters, e.g. 'DLV'
 * @returns {Promise<string>}
 */
async function freshPlate(prisma, prefix) {
  if (!/^[A-Z]{3}$/.test(prefix)) {
    throw new Error(`freshPlate: prefix must be three uppercase letters, got "${prefix}"`);
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    const placa = `${prefix}-${Math.floor(100 + Math.random() * 900)}`;
    const taken = await prisma.vehicle.findUnique({ where: { placa }, select: { id: true } });
    if (!taken) return placa;
  }

  // Prefix is crowded: scan deterministically for the first free number.
  const used = await prisma.vehicle.findMany({
    where: { placa: { startsWith: `${prefix}-` } },
    select: { placa: true },
  });
  const usedSet = new Set(used.map((v) => v.placa));
  for (let n = 100; n <= 999; n++) {
    const placa = `${prefix}-${n}`;
    if (!usedSet.has(placa)) return placa;
  }
  throw new Error(`freshPlate: no free plate left for prefix ${prefix}`);
}

/**
 * Deletes vehicles with the given plates together with their orders and evidence
 * (PhaseEvent and AiAnalysis rows cascade with the order). Used before creating a
 * fixture with a fixed plate so a leftover from an earlier run cannot collide.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string|string[]} plates
 * @returns {Promise<number>} Number of vehicles removed
 */
async function purgeVehiclesByPlate(prisma, plates) {
  const list = Array.isArray(plates) ? plates : [plates];
  const vehicles = await prisma.vehicle.findMany({
    where: { placa: { in: list } },
    select: { id: true },
  });
  if (vehicles.length === 0) return 0;

  const vehicleIds = vehicles.map((v) => v.id);
  const orders = await prisma.serviceOrder.findMany({
    where: { vehicleId: { in: vehicleIds } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await prisma.evidence.deleteMany({ where: { serviceOrderId: { in: orderIds } } });
    await prisma.serviceOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
  return vehicleIds.length;
}

/**
 * Upserts a test bay with a fixed `numero` and the given occupancy, so a bay left over
 * from an earlier run is reused instead of failing the unique constraint.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} numero
 * @param {boolean} ocupada
 */
function upsertFixtureBay(prisma, numero, ocupada) {
  return prisma.bay.upsert({
    where: { numero },
    update: { ocupada },
    create: { numero, ocupada },
  });
}

/**
 * Removes a fixture bay by `numero` if no order references it any more.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} numero
 */
async function removeFixtureBay(prisma, numero) {
  await prisma.bay
    .deleteMany({ where: { numero, serviceOrders: { none: {} } } })
    .catch(() => {});
}

module.exports = {
  freshPlate,
  purgeVehiclesByPlate,
  upsertFixtureBay,
  removeFixtureBay,
};
