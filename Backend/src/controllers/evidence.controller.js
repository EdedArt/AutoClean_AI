const fs = require('fs');
const prisma = require('../config/db');

/**
 * Upload photo evidence for a service order
 */
const uploadEvidence = async (req, res, next) => {
  try {
    const rawOrderId = req.params.orderId || req.params.id;
    const orderId = parseInt(rawOrderId, 10);

    if (isNaN(orderId)) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se ha proporcionado ningún archivo de imagen' });
    }

    const order = await prisma.serviceOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Service order not found' });
    }

    const etapa = (req.body.etapa && req.body.etapa.trim()) || order.faseActual || 'RECIBIDO';
    const relativeUrl = `/evidence/${req.file.filename}`;

    const evidence = await prisma.evidence.create({
      data: {
        url: relativeUrl,
        etapa,
        serviceOrderId: orderId,
      },
    });

    res.status(201).json(evidence);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

/**
 * Fetch all evidences for a specific service order
 */
const getEvidencesByOrder = async (req, res, next) => {
  try {
    const rawOrderId = req.params.orderId || req.params.id;
    const orderId = parseInt(rawOrderId, 10);

    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const order = await prisma.serviceOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: 'Service order not found' });
    }

    const evidences = await prisma.evidence.findMany({
      where: { serviceOrderId: orderId },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(evidences);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadEvidence,
  getEvidencesByOrder,
};
