"""Sensor platform for Local Grow Box."""
from __future__ import annotations

import logging
import math

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfPressure
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

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
        VPDSensor(hass, manager, config[CONF_TEMP_SENSOR], config[CONF_HUMIDITY_SENSOR])
    ])


class VPDSensor(SensorEntity):
    """Representation of a VPD Sensor."""

    _attr_has_entity_name = True
    _attr_name = "Vapor Pressure Deficit"
    _attr_native_unit_of_measurement = UnitOfPressure.KPA
    _attr_device_class = SensorDeviceClass.PRESSURE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, hass, manager, temp_entity_id, humidity_entity_id):
        """Initialize the sensor."""
        self.hass = hass
        self.manager = manager
        self._temp_entity_id = temp_entity_id
        self._humidity_entity_id = humidity_entity_id
        self._attr_unique_id = f"{manager.entry.entry_id}_vpd"

    async def async_added_to_hass(self):
        """Register callbacks."""
        from homeassistant.helpers.event import async_track_state_change_event

        async def update_sensor(event):
            self.async_schedule_update_ha_state(True)

        self.async_on_remove(
            async_track_state_change_event(
                self.hass, [self._temp_entity_id, self._humidity_entity_id], update_sensor
            )
        )

    def update(self):
        """Calculate VPD."""
        temp_state = self.hass.states.get(self._temp_entity_id)
        hum_state = self.hass.states.get(self._humidity_entity_id)

        if temp_state is None or hum_state is None:
            self._attr_native_value = None
            return

        try:
            T = float(temp_state.state)
            RH = float(hum_state.state)
        except (ValueError, TypeError):
            self._attr_native_value = None
            return

        # Calculate SVP (Saturation Vapor Pressure) in kPa
        # Formula: 0.61078 * exp(17.27 * T / (T + 237.3))
        svp = 0.61078 * math.exp(17.27 * T / (T + 237.3))
        
        # Calculate AVP (Actual Vapor Pressure)
        avp = svp * (RH / 100.0)
        
        # VPD
        vpd = svp - avp
        
        self._attr_native_value = round(vpd, 2)
