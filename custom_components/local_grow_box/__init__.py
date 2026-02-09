"""The Local Grow Box integration."""
from __future__ import annotations

import logging
import datetime
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform, CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    CONF_LIGHT_ENTITY,
    PHASE_LIGHT_HOURS,
    PHASE_VEGETATIVE,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SWITCH, Platform.SELECT]

# Start time for light cycle (e.g., 06:00 AM)
LIGHT_START_HOUR = 6 

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Local Grow Box from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    manager = GrowBoxManager(hass, entry)
    hass.data[DOMAIN][entry.entry_id] = manager
    
    # Start the manager logic
    await manager.async_setup()

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        manager = hass.data[DOMAIN].pop(entry.entry_id)
        manager.async_unload()

    return unload_ok


class GrowBoxManager:
    """Class to manage the Grow Box automation."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry):
        """Initialize the manager."""
        self.hass = hass
        self.entry = entry
        self.config = entry.data
        self._remove_update_listener = None
        
        # State
        self.master_switch_on = True # Default to ON or read from storage?
                                     # Ideally, the switch entity reads/writes this.
        self.current_phase = PHASE_VEGETATIVE
        
    async def async_setup(self):
        """Setup background tasks."""
        # Check every minute
        self._remove_update_listener = async_track_time_interval(
            self.hass, self._async_update_logic, timedelta(minutes=1)
        )
        
    def async_unload(self):
        """Unload and clean up."""
        if self._remove_update_listener:
            self._remove_update_listener()

    async def _async_update_logic(self, now: datetime.datetime):
        """Main automation logic."""
        if not self.master_switch_on:
            return

        light_entity = self.config[CONF_LIGHT_ENTITY]
        light_hours = PHASE_LIGHT_HOURS.get(self.current_phase, 18)
        
        # Calculate schedule
        # Start: 06:00
        # End: 06:00 + hours
        
        # Get current time in local timezone
        now_local = dt_util.now()
        
        start_time = now_local.replace(hour=LIGHT_START_HOUR, minute=0, second=0, microsecond=0)
        end_time = start_time + timedelta(hours=light_hours)
        
        # Handle wrap around midnight if necessary (though with start at 6am and max 24h, it just goes to next day 6am)
        # If now is before 6am, we might be in the previous "day's" cycle if it went past midnight.
        # But simple logic: 
        # If light_hours = 18, ON 06:00 - 00:00.
        # If light_hours = 12, ON 06:00 - 18:00.
        
        is_light_time = False
        
        if light_hours >= 24:
            is_light_time = True
        elif light_hours <= 0:
            is_light_time = False
        else:
             # Check if we are in the window
             # Case 1: Start < End (Normal day)
             # Case 2: End < Start (Overnight)
             
             # Let's use simple hour comparison for 6am start
             # If hours=18, end is 00:00 next day.
             # So interval is [06:00, 00:00)
             
             # Let's Normalize to today
             check_time = now_local
             
             # If we are strictly working with "Hours from start time":
             # elapsed = now - start_time
             # if 0 <= elapsed.total_seconds() < light_hours * 3600: ON
             
             # But we need to handle "Start time was yesterday"
             # E.g. It is 01:00 AM. Start was yesterday 06:00.
             
             # Let's find the most recent start time
             if now_local.hour < LIGHT_START_HOUR:
                 start_time = start_time - timedelta(days=1)
             
             elapsed = (now_local - start_time).total_seconds()
             duration = light_hours * 3600
             
             if 0 <= elapsed < duration:
                 is_light_time = True
        
        # Get current state of light
        current_state = self.hass.states.get(light_entity)
        if not current_state:
            return

        is_on = current_state.state == "on"
        
        if is_light_time and not is_on:
            _LOGGER.info("Turning light ON for phase %s", self.current_phase)
            await self.hass.services.async_call(
                "homeassistant", "turn_on", {"entity_id": light_entity}
            )
        elif not is_light_time and is_on:
            _LOGGER.info("Turning light OFF for phase %s", self.current_phase)
            await self.hass.services.async_call(
                "homeassistant", "turn_off", {"entity_id": light_entity}
            )

    def set_master_switch(self, state: bool):
        """Set master switch state."""
        self.master_switch_on = state
        # Trigger update immediately?
        # self.hass.async_create_task(self._async_update_logic(dt_util.now()))

    def set_phase(self, phase: str):
        """Set grow phase."""
        self.current_phase = phase
