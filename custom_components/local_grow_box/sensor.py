"""Sensor platform for Local Grow Box."""
from __future__ import annotations

import logging
import math

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfPressure
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity # If needed

from .const import DOMAIN, CONF_TEMP_SENSOR, CONF_HUMIDITY_SENSOR

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the sensor platform."""
    # Retrieve the manager
    manager = hass.data[DOMAIN][entry.entry_id]
    config = manager.config
    
    async_add_entities([
        GrowBoxVPDSensor(hass, manager, entry.entry_id),
        GrowBoxDaysInPhaseSensor(hass, manager, entry.entry_id)
    ])

class GrowBoxVPDSensor(SensorEntity):
    """Representation of a VPD Sensor."""

    _attr_has_entity_name = True
    _attr_name = "Vapor Pressure Deficit"
    _attr_native_unit_of_measurement = "kPa"
    _attr_device_class = None # specific device class for VPD? Pressure? Generic for now.
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:water-percent"

    def __init__(self, hass, manager, entry_id):
        """Initialize the sensor."""
        self.hass = hass
        self.manager = manager
        self._entry_id = entry_id
        self._attr_unique_id = f"{entry_id}_vpd"

    @property
    def native_value(self) -> float:
        """Return the value of the sensor."""
        return round(self.manager.vpd, 2)
        
    async def async_added_to_hass(self) -> None:
        """Register callbacks."""
        # The manager updates logic every minute, we should update state then too?
        # Ideally manager calls update_ha_state on entities.
        # For now, let's poll or rely on generic updates. 
        # Since we are local_polling, HA will ask us.
        pass
        
    def update(self):
        """Fetch new state data for the sensor."""
        # Manager calculates VPD using its own loop.
        pass

class GrowBoxDaysInPhaseSensor(SensorEntity):
    """Representation of Days in Phase Sensor."""

    _attr_has_entity_name = True
    _attr_name = "Days in Current Phase"
    _attr_native_unit_of_measurement = "days"
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, hass, manager, entry_id):
        """Initialize the sensor."""
        self.hass = hass
        self.manager = manager
        self._entry_id = entry_id
        self._attr_unique_id = f"{entry_id}_days_in_phase"

    @property
    def native_value(self) -> int:
        """Return the value of the sensor."""
        return self.manager.days_in_phase




