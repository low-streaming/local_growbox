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
    CONF_PHASE_SEEDLING_HOURS,
    CONF_PHASE_VEGETATIVE_HOURS,
    CONF_PHASE_FLOWERING_HOURS,
    CONF_PHASE_DRYING_HOURS,
    CONF_PHASE_CURING_HOURS,
    CONF_CUSTOM1_NAME, CONF_CUSTOM1_HOURS,
    CONF_CUSTOM2_NAME, CONF_CUSTOM2_HOURS,
    CONF_CUSTOM3_NAME, CONF_CUSTOM3_HOURS,
    PHASE_SEEDLING,
    PHASE_FLOWERING,
    PHASE_DRYING,
    PHASE_CURING,
    CONF_PUMP_DURATION,
    CONF_MOISTURE_SENSOR,
    CONF_TARGET_MOISTURE,
    CONF_TARGET_MOISTURE,
    CONF_LIGHT_START_HOUR,
    CONF_PHASE_START_DATE,
    DEFAULT_PUMP_DURATION,
    DEFAULT_TARGET_MOISTURE,
    DEFAULT_LIGHT_START_HOUR,
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

        # Load Phase & Start Date
        self.current_phase = self.config.get("current_phase", PHASE_VEGETATIVE)
        
        self.phase_start_date = None
        start_date_str = self.config.get(CONF_PHASE_START_DATE)
        if start_date_str:
            try:
                self.phase_start_date = datetime.datetime.fromisoformat(start_date_str)
            except ValueError:
                pass
        
        if self.phase_start_date is None:
             self.phase_start_date = dt_util.now()

        # Calculated properties
        self.vpd = 0.0
        
        self.pump_start_time: datetime.datetime | None = None

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

    @property
    def days_in_phase(self) -> int:
        """Return number of days in current phase."""
        if not self.phase_start_date:
            return 0
        delta = dt_util.now() - self.phase_start_date
        return max(0, delta.days)

    async def _async_update_logic(self, now: datetime.datetime):
        """Main automation logic."""
        if not self.master_switch_on:
            return

        await self._async_update_light_logic(now)
        await self._async_update_climate_logic(now)
        await self._async_update_water_logic(now)

    async def _async_update_light_logic(self, now: datetime.datetime):
        """Handle Light Schedule."""
        light_entity = self.config[CONF_LIGHT_ENTITY]
        
        # Determine light hours based on current phase (Standard or Custom)
        light_hours = 0
        phase = self.current_phase

        # Standard Phases
        if phase == PHASE_SEEDLING:
            light_hours = self.config.get(CONF_PHASE_SEEDLING_HOURS, 18)
        elif phase == PHASE_VEGETATIVE:
            light_hours = self.config.get(CONF_PHASE_VEGETATIVE_HOURS, 18)
        elif phase == PHASE_FLOWERING:
            light_hours = self.config.get(CONF_PHASE_FLOWERING_HOURS, 12)
        elif phase == PHASE_DRYING:
            light_hours = self.config.get(CONF_PHASE_DRYING_HOURS, 0)
        elif phase == PHASE_CURING:
            light_hours = self.config.get(CONF_PHASE_CURING_HOURS, 0)
        
        # Custom Phases (Check by Name)
        elif phase == self.config.get(CONF_CUSTOM1_NAME):
            light_hours = self.config.get(CONF_CUSTOM1_HOURS, 0)
        elif phase == self.config.get(CONF_CUSTOM2_NAME):
            light_hours = self.config.get(CONF_CUSTOM2_HOURS, 0)
        elif phase == self.config.get(CONF_CUSTOM3_NAME):
            light_hours = self.config.get(CONF_CUSTOM3_HOURS, 0)
        
        # Fallback to hardcoded defaults if not found (shouldn't happen for standard phases)
        else:
             light_hours = PHASE_LIGHT_HOURS.get(phase, 12)

        # Calculate schedule
        start_hour = self.config.get(CONF_LIGHT_START_HOUR) or DEFAULT_LIGHT_START_HOUR
        now_local = dt_util.now()
        start_time = now_local.replace(hour=int(start_hour), minute=0, second=0, microsecond=0)

        # Handle wrap around if current time is before start time (e.g. 01:00 AM)
        if now_local.hour < int(start_hour):
             start_time = start_time - timedelta(days=1)

        elapsed = (now_local - start_time).total_seconds()
        duration = float(light_hours) * 3600

        is_light_time = 0 <= elapsed < duration

        # Get current state of light
        current_state = self.hass.states.get(light_entity)
        if not current_state:
            return

        is_on = current_state.state == "on"

        _LOGGER.debug(
            "Light Logic - Phase: %s, Light Hours: %s, Start: %s, Now: %s, Elapsed: %s, Duration: %s, Is Light Time: %s",
            phase, light_hours, start_time, now_local, elapsed, duration, is_light_time
        )

        msg = f"Phase: {phase}, Hours: {light_hours}, Start: {start_hour}:00, Now: {now_local.strftime('%H:%M')}, ON: {is_light_time}"
        
        if is_light_time and not is_on:
            _LOGGER.info("Turning light ON for phase %s", self.current_phase)
            await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": light_entity})
            self.hass.components.persistent_notification.async_create(f"Turning Light ON. {msg}", title="Grow Box Debug")
            
        elif not is_light_time and is_on:
            _LOGGER.info("Turning light OFF for phase %s", self.current_phase)
            await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": light_entity})
            self.hass.components.persistent_notification.async_create(f"Turning Light OFF. {msg}", title="Grow Box Debug")

    async def _async_update_water_logic(self, now: datetime.datetime):
        """Handle Water Pump Logic."""
        pump_entity = self.config.get("water_pump_entity") # Using literal temporarily as const might be missing locally
        if not pump_entity:
            # Try to find it from standard config if not found
            # Actually we likely defined it in const as CONF_PUMP_ENTITY but user might not have migrated
            # Let's check typical key
            pump_entity = self.config.get("pump_entity")

        if not pump_entity:
            return

        pump_state = self.hass.states.get(pump_entity)
        if not pump_state:
            return

        is_on = pump_state.state == "on"
        duration = self.config.get(CONF_PUMP_DURATION, DEFAULT_PUMP_DURATION)
        
        # 1. Handle Auto-Off (Duration Limit)
        if is_on:
            if self.pump_start_time is None:
                self.pump_start_time = now # Start tracking now if we missed the start event
            
            elapsed = (now - self.pump_start_time).total_seconds()
            if elapsed > duration:
                 _LOGGER.info("Pump run time exceeded (%s sec). Turning OFF.", elapsed)
                 await self.hass.services.async_call(
                    "homeassistant", "turn_off", {"entity_id": pump_entity}
                 )
                 self.pump_start_time = None
        else:
            self.pump_start_time = None

        # 2. Handle Auto-On (Soil Moisture)
        if not is_on:
            moisture_entity = self.config.get(CONF_MOISTURE_SENSOR)
            target = self.config.get(CONF_TARGET_MOISTURE, DEFAULT_TARGET_MOISTURE)
            
            if moisture_entity:
                state = self.hass.states.get(moisture_entity)
                if state and state.state not in ["unknown", "unavailable"]:
                    try:
                        val = float(state.state)
                        if val < target:
                            _LOGGER.info("Soil moisture low (%.1f < %.1f). Turning Pump ON.", val, target)
                            await self.hass.services.async_call(
                                "homeassistant", "turn_on", {"entity_id": pump_entity}
                            )
                            self.pump_start_time = now
                    except ValueError:
                        pass

    async def _async_update_climate_logic(self, now: datetime.datetime):
        """Handle Fan and VPD."""
        temp_entity = self.config[CONF_TEMP_SENSOR]
        humid_entity = self.config[CONF_HUMIDITY_SENSOR]
        fan_entity = self.config[CONF_FAN_ENTITY]

        target_temp = self.config.get(CONF_TARGET_TEMP)
        if target_temp is None:
            target_temp = DEFAULT_TARGET_TEMP
            
        max_humidity = self.config.get(CONF_MAX_HUMIDITY)
        if max_humidity is None:
            max_humidity = DEFAULT_MAX_HUMIDITY

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
        module_url="/local_grow_box/local-grow-box-panel.js?v=1.2.0",
        sidebar_title="Grow Room",
        sidebar_icon="mdi:sprout",
        require_admin=False,
    )

    # Register Websocket API for image upload and config update
    websocket_api.async_register_command(hass, ws_upload_image)
    websocket_api.async_register_command(hass, ws_update_config)
    
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

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/update_config",
    vol.Required("entry_id"): str,
    vol.Required("config"): dict,
})
@websocket_api.async_response
async def ws_update_config(hass, connection, msg):
    """Handle config update."""
    entry_id = msg["entry_id"]
    new_config = msg["config"]
    
    entry = hass.config_entries.async_get_entry(entry_id)
    if not entry:
        connection.send_error(msg["id"], "not_found", "Entry not found")
        return

    # Handle Phase Change Logic
    # If phase is changing, reset start date (unless start date is also being manually set)
    current_options = entry.options
    
    updates = {**new_config}
    
    # Check if phase changed
    if "current_phase" in new_config:
        # Use merged config to get old phase, in case it wasn't in options yet
        full_config = {**entry.data, **current_options}
        old_phase = full_config.get("current_phase")
        new_phase = new_config.get("current_phase")
        
        if old_phase != new_phase and CONF_PHASE_START_DATE not in new_config:
            # Phase changed, and user didn't manually set a date -> Reset to Now
            updates[CONF_PHASE_START_DATE] = dt_util.now().isoformat()
            
    # Update options
    hass.config_entries.async_update_entry(entry, options={**current_options, **updates})
    # Reload entry to apply changes
    await hass.config_entries.async_reload(entry_id)
    
    connection.send_result(msg["id"], {"options": dict(entry.options)})

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
