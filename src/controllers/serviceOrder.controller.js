const asyncHandler = require('../utils/asyncHandler');
const serviceOrderService = require('../services/serviceOrder.service');

/**
 * Fetch all service orders with nested vehicle, package, and bay data
 * Supports filtering by placa, fase, bayId, activeOnly, pagination/sort, and role-based ownership.
 */
const getServiceOrders = asyncHandler(async (req, res) => {
  const response = await serviceOrderService.listServiceOrders(req.query || {}, req.user);
  res.status(200).json(response);
});

/**
 * Create a new service order
 */
const createServiceOrder = asyncHandler(async (req, res) => {
  const newOrder = await serviceOrderService.createServiceOrder(req.body);
  res.status(201).json(newOrder);
});

/**
 * Update the service phase of an order and automatically calculate progress percentage
 */
const updateServicePhase = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { faseActual } = req.body;
  const updatedOrder = await serviceOrderService.updateServicePhase(id, faseActual);
  res.status(200).json(updatedOrder);
});

/**
 * AI Delivery Time Prediction endpoint (Simulated)
 * Returns estimated delivery time, deterministic accuracy percentage, and recalculation status
 */
const getOrderPrediction = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const prediction = await serviceOrderService.getOrderPrediction(id, req.user);
  res.status(200).json(prediction);
});

/**
 * Track the latest service order for a given vehicle plate (placa)
 */
const trackOrderByPlaca = asyncHandler(async (req, res) => {
  const { placa } = req.params;
  const result = await serviceOrderService.trackOrderByPlaca(placa, req.user);
  res.status(200).json(result);
});

/**
 * Demo Control: Force immediate advancement to the next phase
 */
const simulateAdvanceOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedOrder = await serviceOrderService.simulateAdvanceOrder(id);
  res.status(200).json(updatedOrder);
});

/**
 * Demo Control: Reset an order back to PENDIENTE (10%) and restart simulation timer
 */
const simulateResetOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedOrder = await serviceOrderService.simulateResetOrder(id);
  res.status(200).json(updatedOrder);
});

/**
 * Demo Control: Force order directly to LISTO (100%)
 */
const simulateCompleteOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedOrder = await serviceOrderService.simulateCompleteOrder(id);
  res.status(200).json(updatedOrder);
});

/**
 * Mark a service order as ready to wash (OPERARIO only)
 */
const markOrderReady = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedOrder = await serviceOrderService.markOrderReady(id);
  res.status(200).json(updatedOrder);
});

/**
 * Deliver a service order (OPERARIO only)
 * Sets deliveredAt = now if order is in LISTO phase and not already delivered.
 */
const deliverServiceOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deliveredOrder = await serviceOrderService.deliverServiceOrder(id);
  res.status(200).json(deliveredOrder);
});

/**
 * Get timeline events of a service order
 */
const getOrderTimeline = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const timeline = await serviceOrderService.getOrderTimeline(id, req.user);
  res.status(200).json(timeline);
});

module.exports = {
  getServiceOrders,
  createServiceOrder,
  updateServicePhase,
  markOrderReady,
  getOrderTimeline,
  trackOrderByPlaca,
  getOrderPrediction,
  simulateAdvanceOrder,
  simulateResetOrder,
  simulateCompleteOrder,
  deliverServiceOrder,
};
