"""Switch platform for Local Grow Box."""
from __future__ import annotations

import logging

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the switch platform."""
    manager = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([GrowBoxMasterSwitch(hass, manager, entry.entry_id)])


class GrowBoxMasterSwitch(SwitchEntity, RestoreEntity):
    """Representation of the Master Switch."""

    _attr_has_entity_name = True
    _attr_name = "Master Control"
    _attr_icon = "mdi:power"

    def __init__(self, hass, manager, entry_id):
        """Initialize the switch."""
        self.hass = hass
        self.manager = manager
        self._entry_id = entry_id
        self._attr_unique_id = f"{entry_id}_master_switch"
        self._is_on = manager.master_switch_on

    @property
    def is_on(self) -> bool:
        """Return true if switch is on."""
        return self._is_on

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added."""
        await super().async_added_to_hass()
        if (last_state := await self.async_get_last_state()) is not None:
            if last_state.state == "on":
                self._is_on = True
            else:
                self._is_on = False
            # Sync manager
            self.manager.set_master_switch(self._is_on)

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the switch on."""
        self._is_on = True
        self.manager.set_master_switch(True)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the switch off."""
        self._is_on = False
        self.manager.set_master_switch(False)
        self.async_write_ha_state()
