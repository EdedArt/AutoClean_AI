const asyncHandler = require('../utils/asyncHandler');
const vehicleService = require('../services/vehicle.service');

/**
 * Fetch all vehicles with search, pagination and role-based ownership filtering
 */
const getVehicles = asyncHandler(async (req, res) => {
  const response = await vehicleService.listVehicles(req.query || {}, req.user);
  res.status(200).json(response);
});

/**
 * Fetch a single vehicle by ID with ownership verification
 */
const getVehicleById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const vehicle = await vehicleService.getVehicleById(id, req.user);
  res.status(200).json(vehicle);
});

/**
 * Create a new vehicle
 */
const createVehicle = asyncHandler(async (req, res) => {
  const newVehicle = await vehicleService.createVehicle(req.body);
  res.status(201).json(newVehicle);
});

/**
 * Link or update vehicle owner by client email
 */
const updateVehicleOwner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ownerEmail } = req.body;
  const updatedVehicle = await vehicleService.updateVehicleOwner(id, ownerEmail);
  res.status(200).json(updatedVehicle);
});

module.exports = {
  getVehicles,
  getVehicleById,
  createVehicle,
  updateVehicleOwner,
};
