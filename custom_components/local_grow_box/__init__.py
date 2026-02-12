"""The Local Grow Box integration."""
from __future__ import annotations

import logging
import datetime
import math
import os
import base64
import voluptuous as vol
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform, CONF_NAME
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util
from homeassistant.components.http import StaticPathConfig
from homeassistant.components import panel_custom, websocket_api

from .const import (
    DOMAIN,
    CONF_LIGHT_ENTITY,
    CONF_FAN_ENTITY,
    CONF_TEMP_SENSOR,
    CONF_HUMIDITY_SENSOR,
    CONF_TARGET_TEMP,
    CONF_MAX_HUMIDITY,
    DEFAULT_TARGET_TEMP,
    DEFAULT_MAX_HUMIDITY,
    PHASE_LIGHT_HOURS,
    PHASE_VEGETATIVE,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SWITCH, Platform.SELECT]

# Start time for light cycle (e.g., 06:00 AM)
LIGHT_START_HOUR = 6 

class GrowBoxManager:
    """Class to manage the Grow Box automation."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry):
        """Initialize the manager."""
        self.hass = hass
        self.entry = entry
        # Merge data and options, options take precedence
        self.config = {**entry.data, **entry.options}
        self._remove_update_listener = None

        # State
        self.master_switch_on = True
        self.current_phase = PHASE_VEGETATIVE
        self.vpd = 0.0
        self.days_in_phase = 0 # TODO: Track this persistently

    async def async_setup(self):
        """Setup background tasks."""
        # Check every minute
        self._remove_update_listener = async_track_time_interval(
            self.hass, self._async_update_logic, timedelta(minutes=1)
        )
        # Run immediately
        self.hass.async_create_task(self._async_update_logic(dt_util.now()))

    def async_unload(self):
        """Unload and clean up."""
        if self._remove_update_listener:
            self._remove_update_listener()

    async def _async_update_logic(self, now: datetime.datetime):
        """Main automation logic."""
        if not self.master_switch_on:
            return

        await self._async_update_light_logic(now)
        await self._async_update_climate_logic(now)

    async def _async_update_light_logic(self, now: datetime.datetime):
        """Handle Light Schedule."""
        light_entity = self.config[CONF_LIGHT_ENTITY]
        light_hours = PHASE_LIGHT_HOURS.get(self.current_phase, 18)

        # Calculate schedule - Simple 06:00 Start
        now_local = dt_util.now()
        start_time = now_local.replace(hour=LIGHT_START_HOUR, minute=0, second=0, microsecond=0)

        # Handle wrap around if current time is before start time (e.g. 01:00 AM)
        if now_local.hour < LIGHT_START_HOUR:
             start_time = start_time - timedelta(days=1)

        elapsed = (now_local - start_time).total_seconds()
        duration = light_hours * 3600

        is_light_time = 0 <= elapsed < duration

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

    async def _async_update_climate_logic(self, now: datetime.datetime):
        """Handle Fan and VPD."""
        temp_entity = self.config[CONF_TEMP_SENSOR]
        humid_entity = self.config[CONF_HUMIDITY_SENSOR]
        fan_entity = self.config[CONF_FAN_ENTITY]

        target_temp = self.config.get(CONF_TARGET_TEMP, DEFAULT_TARGET_TEMP)
        max_humidity = self.config.get(CONF_MAX_HUMIDITY, DEFAULT_MAX_HUMIDITY)

        temp_state = self.hass.states.get(temp_entity)
        humid_state = self.hass.states.get(humid_entity)

        if not temp_state or not humid_state:
             return

        try:
            current_temp = float(temp_state.state)
            current_humid = float(humid_state.state)
        except ValueError:
            return

        # VPD Calculation
        # SVP = 0.61078 * exp((17.27 * T) / (T + 237.3))
        # VPD = SVP * (1 - RH / 100)
        # Leaf temperature offset is ignored for simplicity (~ -2C usually)

        svp = 0.61078 * math.exp((17.27 * current_temp) / (current_temp + 237.3))
        self.vpd = svp * (1 - current_humid / 100)

        # Fan Control Logic (Bang-bang controller with hysteresis)
        fan_state = self.hass.states.get(fan_entity)
        if not fan_state:
            return

        is_fan_on = fan_state.state == "on"
        should_fan_on = False

        # Logic: Turn ON if too hot OR too humid
        if current_temp > target_temp or current_humid > max_humidity:
            should_fan_on = True

        # Logic: Turn OFF if cool enough AND dry enough (w/ hysteresis)
        # Hysteresis: 1.0 C / 5.0 %
        elif current_temp < (target_temp - 1.0) and current_humid < (max_humidity - 5.0):
             should_fan_on = False
        else:
             # Keep current state (Deadband)
             should_fan_on = is_fan_on

        if should_fan_on and not is_fan_on:
             _LOGGER.info("Turning fan ON. Temp: %s, Humid: %s", current_temp, current_humid)
             await self.hass.services.async_call(
                 "homeassistant", "turn_on", {"entity_id": fan_entity}
             )
        elif not should_fan_on and is_fan_on:
             _LOGGER.info("Turning fan OFF. Temp: %s, Humid: %s", current_temp, current_humid)
             await self.hass.services.async_call(
                 "homeassistant", "turn_off", {"entity_id": fan_entity}
             )

    def set_master_switch(self, state: bool):
        """Set master switch state."""
        self.master_switch_on = state
        self.hass.async_create_task(self._async_update_logic(dt_util.now()))

    def set_phase(self, phase: str):
        """Set grow phase."""
        self.current_phase = phase
        self.hass.async_create_task(self._async_update_logic(dt_util.now()))


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Local Grow Box component."""
    # Register the frontend panel
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            "/local_grow_box",
            hass.config.path("custom_components/local_grow_box/frontend"),
            True
        )
    ])

    # Create storage directory for images
    img_path = hass.config.path("www", "local_grow_box_images")
    if not os.path.exists(img_path):
        os.makedirs(img_path)

    # Register custom panel
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="local-grow-box-panel",
        frontend_url_path="grow-room",
        module_url="/local_grow_box/local-grow-box-panel.js?v=1.1.2",
        sidebar_title="Grow Room",
        sidebar_icon="mdi:sprout",
        require_admin=False,
    )

    # Register Websocket API for image upload
    websocket_api.async_register_command(hass, ws_upload_image)
    
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Local Grow Box from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    manager = GrowBoxManager(hass, entry)
    hass.data[DOMAIN][entry.entry_id] = manager

    await manager.async_setup()

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    manager = hass.data[DOMAIN].pop(entry.entry_id)
    manager.async_unload()

    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry."""
    await hass.config_entries.async_reload(entry.entry_id)


@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/upload_image",
    vol.Required("device_id"): str,
    vol.Required("image"): str, # Base64 encoded
})
@websocket_api.async_response
async def ws_upload_image(hass, connection, msg):
    """Handle image upload."""
    device_id = msg["device_id"]
    image_data = msg["image"]
    
    # Remove header if present (data:image/jpeg;base64,...)
    if "," in image_data:
        image_data = image_data.split(",")[1]

    try:
        decoded = base64.b64decode(image_data)
        img_path = hass.config.path("www", "local_grow_box_images", f"{device_id}.jpg")
        
        def _write_file():
            with open(img_path, "wb") as f:
                f.write(decoded)

        await hass.async_add_executor_job(_write_file)
        # Use a timestamp to force cache refresh on the client side if needed, 
        # though the client usually handles that.
        connection.send_result(msg["id"], {"path": f"/local/local_grow_box_images/{device_id}.jpg"})
    except Exception as e:
        connection.send_error(msg["id"], "upload_failed", str(e))
