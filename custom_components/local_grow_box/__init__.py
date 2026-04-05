"""The Local Grow Box integration."""
from __future__ import annotations

import logging
import datetime
import math
import os
import json
import base64
import voluptuous as vol
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util
from homeassistant.components.http import StaticPathConfig
from homeassistant.components import panel_custom, websocket_api
from homeassistant.exceptions import HomeAssistantError

from .const import (
    DOMAIN, CONF_LIGHT_ENTITY, CONF_FAN_ENTITY, CONF_TEMP_SENSOR, CONF_HUMIDITY_SENSOR,
    CONF_TARGET_TEMP, CONF_MAX_HUMIDITY, DEFAULT_TARGET_TEMP, DEFAULT_MAX_HUMIDITY,
    CONF_HUMIDIFIER_ENTITY, CONF_MIN_HUMIDITY, DEFAULT_MIN_HUMIDITY,
    PHASE_LIGHT_HOURS, PHASE_VEGETATIVE, CONF_PHASE_SEEDLING_HOURS, CONF_PHASE_VEGETATIVE_HOURS,
    CONF_PHASE_FLOWERING_HOURS, CONF_PHASE_DRYING_HOURS, CONF_PHASE_CURING_HOURS,
    CONF_CUSTOM1_NAME, CONF_CUSTOM1_HOURS, CONF_CUSTOM2_NAME, CONF_CUSTOM2_HOURS,
    CONF_CUSTOM3_NAME, CONF_CUSTOM3_HOURS, PHASE_SEEDLING, PHASE_FLOWERING, PHASE_DRYING,
    PHASE_CURING, CONF_PUMP_DURATION, CONF_MOISTURE_SENSOR, CONF_TARGET_MOISTURE,
    CONF_LIGHT_START_HOUR, CONF_PHASE_START_DATE, DEFAULT_PUMP_DURATION,
    CONF_TARGET_HUMIDITY, CONF_HUMIDIFIER_DURATION, DEFAULT_TARGET_HUMIDITY, 
    DEFAULT_HUMIDIFIER_DURATION, CONF_PUMP_ENTITY, CONF_CAMERA_ENTITY,
    CONF_HUMIDITY_HYSTERESIS, DEFAULT_HUMIDITY_HYSTERESIS,
    CONF_TEMP_HYSTERESIS, DEFAULT_TEMP_HYSTERESIS,
    CONF_FAN_HYSTERESIS, DEFAULT_FAN_HYSTERESIS,
    DEFAULT_LIGHT_START_HOUR, DEFAULT_TARGET_MOISTURE,
    CONF_ENERGY_SENSOR, CONF_POWER_SENSOR, CONF_ELECTRIC_PRICE,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SWITCH, Platform.SELECT]

class GrowBoxManager:
    """Class to manage the Grow Box automation."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry):
        """Initialize the manager."""
        self.hass = hass
        self.entry = entry
        self.config = {**entry.data, **entry.options}
        self._remove_update_listener = None
        self.master_switch_on = True
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

        self.vpd = None
        self.pump_start_time = None
        # Initialize timers in the past so devices can start immediately on restart if needed
        self.last_pump_stop_time = dt_util.now() - timedelta(hours=1)
        
        self.humidifier_start_time = None
        self.last_humidifier_stop_time = dt_util.now() - timedelta(hours=1)
        
        self.logs = []
        self._last_log_state = {}
        self._log_file_path = hass.config.path(f".storage", f"local_grow_box_logs_{self.entry.entry_id}.json")
        self._load_logs()
        
        self.grows = []
        self._grows_file_path = hass.config.path(".storage", f"local_grow_box_grows_{self.entry.entry_id}.json")
        self._load_grows()

        self._update_callbacks = []
        self._last_display_update = None
        self._last_daily_snapshot_date = None

    @property
    def days_in_phase(self) -> int:
        """Get days in current phase."""
        if not self.phase_start_date:
            return 0
        delta = dt_util.now() - self.phase_start_date
        return max(0, delta.days)

    def async_register_update_callback(self, callback):
        """Register callback for status updates."""
        if callback not in self._update_callbacks:
            self._update_callbacks.append(callback)
        
        # Return remover function
        return lambda: self._update_callbacks.remove(callback)

    def async_update_listeners(self):
        """Update all registered listeners."""
        for callback in self._update_callbacks:
            callback()

    def _load_logs(self):
        """Load logs from file."""
        if os.path.exists(self._log_file_path):
            try:
                with open(self._log_file_path, "r", encoding="utf-8") as f:
                    self.logs = json.load(f)
                    
                    # Reconstruct last state from history
                    # We reverse so we process oldest -> newest (self.logs has newest at index 0)
                    for log in reversed(self.logs):
                        try:
                            msg = log.split("] ", 1)[-1]
                            prefix = msg.split(" (")[0]
                            category = prefix.split(" ")[0]
                            self._last_log_state[category] = prefix
                        except Exception:
                            pass
            except Exception as e:
                _LOGGER.error("Failed to load Local Grow Box logs: %s", e)

    def _save_logs(self):
        """Save logs to file."""
        try:
            with open(self._log_file_path, "w", encoding="utf-8") as f:
                json.dump(self.logs, f)
        except Exception as e:
            pass # avoid spamming if permissions fail

    def _load_grows(self):
        """Load grows history from file."""
        if os.path.exists(self._grows_file_path):
            try:
                with open(self._grows_file_path, "r", encoding="utf-8") as f:
                    self.grows = json.load(f)
            except Exception as e:
                _LOGGER.error("Failed to load Local Grow Box grows: %s", e)

    def _save_grows(self):
        """Save grows history to file."""
        try:
            with open(self._grows_file_path, "w", encoding="utf-8") as f:
                json.dump(self.grows, f)
        except Exception as e:
            _LOGGER.error("Failed to save Local Grow Box grows: %s", e)

    def start_grow(self, name, strain="", expected_weeks=8):
        """Start a new grow cycle."""
        # Archive any currently active grow if needed...
        for g in self.grows:
            if g.get("status") == "active":
                g["status"] = "finished"
                g["end_date"] = dt_util.now().isoformat()
        
        start_energy = 0
        energy_entities = self.config.get(CONF_ENERGY_SENSOR)
        if energy_entities:
            # Handle both string and list
            ent_list = [energy_entities] if isinstance(energy_entities, str) else energy_entities
            for ent_id in ent_list:
                state = self.hass.states.get(ent_id)
                if state and state.state not in ["unavailable", "unknown"]:
                    try:
                        start_energy += float(state.state)
                    except ValueError:
                        pass

        new_grow = {
            "id": f"grow_{int(dt_util.now().timestamp())}",
            "name": name,
            "strain": strain,
            "start_date": dt_util.now().isoformat(),
            "end_date": None,
            "expected_weeks": expected_weeks,
            "start_energy": start_energy,
            "end_energy": None,
            "status": "active",
            "notes": "",
            "events": [],
            "vpd_total_mins": 0,
            "vpd_ideal_mins": 0,
            "consumed_kwh": 0
        }
        self.grows.insert(0, new_grow)
        self.hass.async_create_task(self.hass.async_add_executor_job(self._save_grows))
        self.add_log(f"Neuer Grow gestartet: {name} ({expected_weeks} Wochen geplant)")

    def stop_grow(self, grow_id):
        """Finish a grow cycle."""
        end_energy = 0
        energy_entities = self.config.get(CONF_ENERGY_SENSOR)
        if energy_entities:
            ent_list = [energy_entities] if isinstance(energy_entities, str) else energy_entities
            for ent_id in ent_list:
                state = self.hass.states.get(ent_id)
                if state and state.state not in ["unavailable", "unknown"]:
                    try:
                        end_energy += float(state.state)
                    except ValueError:
                        pass

        for g in self.grows:
            if g["id"] == grow_id:
                g["status"] = "finished"
                g["end_date"] = dt_util.now().isoformat()
                g["end_energy"] = end_energy
                # Final cost calculation
                price = self.config.get(CONF_ELECTRIC_PRICE, 0.35)
                # Use integrated energy if available and > 0, else fall back to total energy diff
                consumed = g.get("consumed_kwh", 0)
                if consumed <= 0:
                    consumed = end_energy - g.get("start_energy", 0)
                
                g["total_cost"] = round(consumed * price, 2)
                g["total_kwh"] = round(consumed, 2) # Store final kWh
                self.add_log(f"Grow beendet: {g['name']}. Kosten: {g['total_cost']}€")
                break
    def reset_grow_energy(self, grow_id):
        """Reset energy offset for a specific grow."""
        current_energy = 0
        energy_entities = self.config.get(CONF_ENERGY_SENSOR)
        if energy_entities:
            ent_list = [energy_entities] if isinstance(energy_entities, str) else energy_entities
            for ent_id in ent_list:
                state = self.hass.states.get(ent_id)
                if state and state.state not in ["unavailable", "unknown"]:
                    try:
                        current_energy += float(state.state)
                    except ValueError:
                        pass
        
        for g in self.grows:
            if g["id"] == grow_id:
                g["start_energy"] = current_energy
                g["consumed_kwh"] = 0
                self.add_log(f"Zählerstand zurückgesetzt für: {g['name']}")
                break
        self.hass.async_create_task(self.hass.async_add_executor_job(self._save_grows))

    def add_grow_event(self, grow_id, event_type, note=""):
        """Add a milestone event to a grow."""
        for g in self.grows:
            if g["id"] == grow_id:
                if "events" not in g:
                    g["events"] = []
                g["events"].append({
                    "timestamp": dt_util.now().isoformat(),
                    "type": event_type,
                    "note": note
                })
                break
        self.hass.async_create_task(self.hass.async_add_executor_job(self._save_grows))

    def update_grow(self, grow_id, updates):
        """Update grow details."""
        for g in self.grows:
            if g["id"] == grow_id:
                for k, v in updates.items():
                    if k in g:
                        g[k] = v
                break
        self.hass.async_create_task(self.hass.async_add_executor_job(self._save_grows))

    def delete_grow(self, grow_id):
        """Remove a grow entry."""
        self.grows = [g for g in self.grows if g["id"] != grow_id]
        self.hass.async_create_task(self.hass.async_add_executor_job(self._save_grows))

    def add_log(self, message: str):
        """Add a log entry with timestamp."""
        prefix = message.split(" (")[0]
        category = prefix.split(" ")[0]
        
        # Deduplication check
        if self._last_log_state.get(category) == prefix:
            return  # Same action already logged recently
            
        self._last_log_state[category] = prefix

        timestamp = dt_util.now().strftime("%d.%m.%Y %H:%M:%S")
        self.logs.insert(0, f"[{timestamp}] {message}")
        
        if len(self.logs) > 1000:
            self.logs.pop()
            
        self.hass.async_create_task(self.hass.async_add_executor_job(self._save_logs))

    async def async_setup(self):
        """Setup background tasks."""
        # Check more frequently (1s) to handle pump duration accurately
        self._remove_update_listener = async_track_time_interval(
            self.hass, self._async_update_logic, timedelta(seconds=1)
        )
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
        now = dt_util.now()
        start = self.phase_start_date
        if start and start.tzinfo is None:
            start = dt_util.as_local(start)
        delta = now - start
        return max(0, delta.days)

    def _get_safe_state(self, entity_id):
        if not entity_id:
            return None
            
        state = self.hass.states.get(entity_id)
        
        # Robust check: If not found, try common domains (sensor, switch)
        if not state and "." not in entity_id:
            for domain in ["sensor", "switch", "binary_sensor"]:
                test_id = f"{domain}.{entity_id}"
                state = self.hass.states.get(test_id)
                if state:
                    self.config[entity_id] = test_id # Update config for next time
                    break
        
        if not state:
            _LOGGER.debug("Entity not found: %s", entity_id)
            return None
            
        if state.state in ["unavailable", "unknown"]:
            _LOGGER.debug("Entity %s is %s", entity_id, state.state)
            return None
            
        return state

    def _get_config_value(self, key, default, type_func=str):
        val = self.config.get(key)
        if val is None or val == "":
            return default
        try:
            return type_func(val)
        except (ValueError, TypeError):
            return default

    async def _async_stop_all_devices(self):
        """Turn off all managed devices if they are currently on."""
        entities = [
            self.config.get(CONF_LIGHT_ENTITY),
            self.config.get(CONF_FAN_ENTITY),
            self.config.get(CONF_PUMP_ENTITY),
            self.config.get(CONF_HUMIDIFIER_ENTITY),
        ]
        
        for entity_id in entities:
            if not entity_id:
                continue
            state = self._get_safe_state(entity_id)
            # Use a slightly broader check for 'on' to handle various device classes
            if state and state.state not in ["off", "unavailable", "unknown"]:
                _LOGGER.info("Master Switch is OFF: Actively turning off %s", entity_id)
                await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": entity_id})

    async def _async_update_logic(self, now: datetime.datetime):
        # 0. Global Sensor Calculations (Always run)
        temp_entity = self.config.get(CONF_TEMP_SENSOR)
        humid_entity = self.config.get(CONF_HUMIDITY_SENSOR)
        temp_state = self._get_safe_state(temp_entity)
        humid_state = self._get_safe_state(humid_entity)
        
        if temp_state and humid_state:
            try:
                current_temp = float(temp_state.state)
                current_humid = float(humid_state.state)
                # Calculate saturated vapor pressure (kPa) and VPD
                svp = 0.61078 * math.exp((17.27 * current_temp) / (current_temp + 237.3))
                self.vpd = svp * (1 - current_humid / 100)
            except ValueError:
                pass

        # 1. Metrics Tracking (Runs independently of Master Switch and Sensors)
        current_time = now
        if not hasattr(self, "_last_metrics_tracking") or (current_time - self._last_metrics_tracking).total_seconds() >= 60:
            self._last_metrics_tracking = current_time
            active_grow = next((g for g in self.grows if g["status"] == "active"), None)
            if active_grow and self.vpd is not None:
                # Store current phase in grow record for frontend
                active_grow["phase"] = self.current_phase
                
                # VPD Tracking (Phase-Specific Ideal Range)
                active_grow["vpd_total_mins"] = active_grow.get("vpd_total_mins", 0) + 1
                
                # Get phase targets
                vmin, vmax = self._get_vpd_target_range(self.current_phase)
                if vmin <= self.vpd <= vmax:
                    active_grow["vpd_ideal_mins"] = active_grow.get("vpd_ideal_mins", 0) + 1
                
                # Energy Integration (Power to kWh)
                power_entities = self.config.get(CONF_POWER_SENSOR)
                if power_entities:
                    ent_list = [power_entities] if isinstance(power_entities, str) else power_entities
                    total_watts = 0
                    for ent_id in ent_list:
                        state = self.hass.states.get(ent_id)
                        if state and state.state not in ["unavailable", "unknown"]:
                            try:
                                total_watts += float(state.state)
                            except ValueError:
                                pass
                    
                    minute_kwh = (total_watts / 60.0) / 1000.0
                    active_grow["consumed_kwh"] = active_grow.get("consumed_kwh", 0) + minute_kwh

                # Persistence check
                if active_grow["vpd_total_mins"] % 5 == 0:
                    self.hass.async_create_task(self.hass.async_add_executor_job(self._save_grows))

            # Push updates to HA sensors exactly once per minute
            self.async_update_listeners()

        if not self.master_switch_on:
            await self._async_stop_all_devices()
            return
            
        # Isolate Light Logic
        try:
            await self._async_update_light_logic(now)
        except Exception as e:
            _LOGGER.error("Error in Light Logic: %s", e)

        # Isolate Climate Logic
        try:
            await self._async_update_climate_logic(now)
        except Exception as e:
            _LOGGER.error("Error in Climate Logic: %s", e)

        # Isolate Water Logic
        try:
            await self._async_update_water_logic(now)
        except Exception as e:
            _LOGGER.error("Error in Water Logic: %s", e)

        # 4. Daily Snapshot Logic
        today = now.date().isoformat()
        if self._last_daily_snapshot_date != today:
            active_grow = next((g for g in self.grows if g["status"] == "active"), None)
            cam_entity = self.config.get(CONF_CAMERA_ENTITY)
            if active_grow and cam_entity:
                # Check if light is currently ON to avoid black photos
                light_entity = self.config.get(CONF_LIGHT_ENTITY)
                light_state = self.hass.states.get(light_entity) if light_entity else None
                is_on = light_state and light_state.state == "on"
                
                # Check if we already have a photo for today in the record
                photos = active_grow.get("photos", [])
                already_has_today = any(p.startswith(today) for p in photos)
                
                if is_on and not already_has_today:
                    self._last_daily_snapshot_date = today
                    self.hass.async_create_task(self._async_take_snapshot(active_grow["id"]))

        # Update Display Logic - Throttle to every 5 seconds

        # Update Display Logic - Throttle to every 5 seconds
        try:
            now_utc = dt_util.utcnow()
            if self._last_display_update is None or (now_utc - self._last_display_update).total_seconds() >= 5:
                await self._async_update_display_logic()
                self._last_display_update = now_utc
        except Exception as e:
            _LOGGER.error("Error in Display Logic: %s", e)

    async def _async_update_display_logic(self):
        """Send current state to ESPHome Display"""
        # Find all display services available
        esphome_services = self.hass.services.async_services().get("esphome", {})
        
        # We look for the base service name of ANY connected display (ignoring the _update_room_X suffix)
        basenames = set()
        for s in esphome_services:
            if "growbox_display" in s and "_update_room_" in s:
                basename = s.rsplit("_update_room_", 1)[0]
                basenames.add(basename)
                
        if not basenames:
             return
             
        # Determine the "Room ID" (1 to 5) for THIS specific Grow Box instance
        # We do this by sorting all configured Local Grow Box entries by their creation/ID
        # so they always get the same slot on the display
        all_entries = self.hass.config_entries.async_entries(DOMAIN)
        # Sort by entry_id to keep the assignment semi-stable
        all_entries.sort(key=lambda x: x.entry_id)
        
        room_index = 1
        for i, entry in enumerate(all_entries):
            if entry.entry_id == self.entry.entry_id:
                room_index = i + 1
                break
                
        # If a user has more than 5 boxes, cap it at 5 since our display only supports 5 pages
        if room_index > 5:
            room_index = 5
            
        target_service_suffix = f"_update_room_{room_index}"
             
        # Gather all current data
        # Use the name the user gave this Grow Box integration instance
        name = self.entry.title if self.entry and self.entry.title else f"Grow Box {room_index}"
        if len(name) > 13:
            name = name[:10] + "..."

        # Temp
        temp_entity = self.config.get(CONF_TEMP_SENSOR)
        temp_state = self._get_safe_state(temp_entity)
        temp_val = "--.-"
        if temp_state:
            try:
                temp_val = f"{float(temp_state.state):.1f}"
            except ValueError:
                temp_val = str(temp_state.state)

        # Hum
        hum_entity = self.config.get(CONF_HUMIDITY_SENSOR)
        hum_state = self._get_safe_state(hum_entity)
        hum_val = "--"
        if hum_state:
            try:
                hum_val = f"{float(hum_state.state):.1f}"
                if hum_val.endswith(".0"):
                    hum_val = hum_val[:-2]
            except ValueError:
                hum_val = str(hum_state.state)

        # Soil
        soil_entity = self.config.get(CONF_MOISTURE_SENSOR)
        soil_state = self._get_safe_state(soil_entity)
        soil_val = "--"
        if soil_state:
            try:
                soil_val = f"{float(soil_state.state):.0f}"
            except ValueError:
                soil_val = str(soil_state.state)

        # VPD is calculated globally in manager
        vpd_val = f"{self.vpd:.2f}" if self.vpd is not None and self.vpd > 0 else "-.--"

        # Light
        light_entity = self.config.get(CONF_LIGHT_ENTITY)
        light_state = self._get_safe_state(light_entity)
        light_str = "Aus"
        if light_state and light_state.state == "on":
            light_str = "An"
            
        # Fan
        fan_entity = self.config.get(CONF_FAN_ENTITY)
        fan_state_obj = self._get_safe_state(fan_entity)
        fan_str = "Aus"
        if fan_state_obj and fan_state_obj.state == "on":
            fan_str = "An"

        display_data = {
            "name": name,
            "temp": temp_val,
            "hum": hum_val,
            "soil": soil_val,
            "vpd": vpd_val,
            "light_state": f"{light_str} ({self.current_phase})",
            "fan_state": fan_str
        }

        # Fire and forget updating all connected screens
        for basename in basenames:
            service_name = f"{basename}{target_service_suffix}"
            try:
                await self.hass.services.async_call("esphome", service_name, display_data)
            except HomeAssistantError as err:
                _LOGGER.debug("Failed to update display %s: %s", service_name, err)
            except Exception as err:
                _LOGGER.error("Unexpected error updating display %s: %s", service_name, err)

    async def _async_update_light_logic(self, now: datetime.datetime):
        light_entity = self.config.get(CONF_LIGHT_ENTITY)
        if not light_entity:
            return
            
        # Check if light is also configured as fan (common conflict)
        fan_entity = self.config.get(CONF_FAN_ENTITY)
        if fan_entity and fan_entity == light_entity:
            _LOGGER.warning("CONFIGURATION ERROR: Light entity is same as Fan entity! This will cause toggling.")

        light_hours = 0
        phase = self.current_phase

        start_hour = self._get_config_value(CONF_LIGHT_START_HOUR, DEFAULT_LIGHT_START_HOUR, int)
        
        # Check Recipe for light hours
        recipe_hours = self._get_recipe_value(phase, "light_hours", None)
        if recipe_hours is not None:
            light_hours = float(recipe_hours)
        else:
            if phase == PHASE_SEEDLING:
                light_hours = self._get_config_value(CONF_PHASE_SEEDLING_HOURS, 18, float)
            elif phase == PHASE_VEGETATIVE:
                light_hours = self._get_config_value(CONF_PHASE_VEGETATIVE_HOURS, 18, float)
            elif phase == PHASE_FLOWERING:
                light_hours = self._get_config_value(CONF_PHASE_FLOWERING_HOURS, 12, float)
            elif phase == PHASE_DRYING:
                light_hours = self._get_config_value(CONF_PHASE_DRYING_HOURS, 0, float)
            elif phase == PHASE_CURING:
                light_hours = self._get_config_value(CONF_PHASE_CURING_HOURS, 0, float)
            elif phase == self.config.get(CONF_CUSTOM1_NAME):
                light_hours = self._get_config_value(CONF_CUSTOM1_HOURS, 0, float)
            elif phase == self.config.get(CONF_CUSTOM2_NAME):
                light_hours = self._get_config_value(CONF_CUSTOM2_HOURS, 0, float)
            elif phase == self.config.get(CONF_CUSTOM3_NAME):
                light_hours = self._get_config_value(CONF_CUSTOM3_HOURS, 0, float)
            else:
                 light_hours = PHASE_LIGHT_HOURS.get(phase, 12)

        start_hour = self._get_config_value(CONF_LIGHT_START_HOUR, DEFAULT_LIGHT_START_HOUR, int)
        
        # Validate start_hour to prevent crash
        if not (0 <= start_hour <= 23):
             _LOGGER.warning("Invalid start_hour %s. Using default.", start_hour)
             start_hour = 18

        now_local = dt_util.now()
        start_time = now_local.replace(hour=int(start_hour), minute=0, second=0, microsecond=0)
        
        # If we are before start_hour relative to 'today starts at 00:00', 
        # then the cycle must have started yesterday.
        if now_local.hour < int(start_hour):
             start_time = start_time - timedelta(days=1)

        elapsed = (now_local - start_time).total_seconds()
        duration = float(light_hours) * 3600
        is_light_time = 0 <= elapsed < duration

        _LOGGER.debug(
            "Light Logic: Phase=%s, Hours=%s, Start=%s, Now=%s, Elapsed=%.1f, Duration=%.1f, IsLightTime=%s", 
            phase, light_hours, start_hour, now_local.strftime("%H:%M"), elapsed, duration, is_light_time
        )

        current_state = self._get_safe_state(light_entity)
        if not current_state:
            return
            
        if current_state.state in ["unavailable", "unknown"]:
            _LOGGER.debug("Light entity %s is unavailable. Skipping.", light_entity)
            return

        is_on = current_state.state == "on"
        
        if is_light_time and not is_on:
            # Check Manual Override (Debounce 15 mins)
            last_changed = current_state.last_changed
            if last_changed:
                diff = (dt_util.utcnow() - last_changed).total_seconds()
                if diff < 10:
                    _LOGGER.info("Light manual override detected (changed %.0fs ago). Skipping auto-control.", diff)
                    return

            _LOGGER.info("Light should be ON. Turning ON.")
            self.add_log("Licht eingeschaltet (Automatik)")
            await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": light_entity})
        elif not is_light_time and is_on:
            # Check Manual Override (Debounce 15 mins)
            last_changed = current_state.last_changed
            if last_changed:
                diff = (dt_util.utcnow() - last_changed).total_seconds()
                if diff < 900:
                    _LOGGER.info("Light manual override detected (changed %.0fs ago). Skipping auto-control.", diff)
                    return

            _LOGGER.info("Light should be OFF. Turning OFF.")
            self.add_log("Licht ausgeschaltet (Automatik)")
            await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": light_entity})

    async def _async_update_water_logic(self, now: datetime.datetime):
        pump_entity = self.config.get(CONF_PUMP_ENTITY)
        if not pump_entity:
            return

        pump_state = self._get_safe_state(pump_entity)
        if not pump_state:
            return
            
        if pump_state.state in ["unavailable", "unknown"]:
            return

        is_on = pump_state.state == "on"
        duration = self._get_config_value(CONF_PUMP_DURATION, DEFAULT_PUMP_DURATION, float)
        
        if is_on:
            # Start tracking if not already
            if not self.pump_start_time:
                 self.pump_start_time = now
            
            elapsed = (now - self.pump_start_time).total_seconds()
            
            if elapsed >= duration:
                 _LOGGER.info("Pump ran for %.1fs. Turning OFF.", elapsed)
                 self.add_log(f"Pumpe ausgeschaltet (Lief {elapsed:.1f}s)")
                 await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": pump_entity})
                 self.last_pump_stop_time = now
                 self.pump_start_time = None
        else:
            # Pump is OFF
            self.pump_start_time = None
            
            # Soak Time Check (15 min)
            if self.last_pump_stop_time:
                 time_off = (now - self.last_pump_stop_time).total_seconds()
                 if time_off < 900: # 900s = 15 min
                      return

            # Moisture Check
            moisture_entity = self.config.get(CONF_MOISTURE_SENSOR)
            if not moisture_entity:
                return
                
            state = self._get_safe_state(moisture_entity)
            if not state or state.state in ["unavailable", "unknown"]:
                return
            
            try:
                val = float(state.state)
                target = self._get_config_value(CONF_TARGET_MOISTURE, DEFAULT_TARGET_MOISTURE, float)
                if val < target:
                     _LOGGER.info("Moisture low (%.1f < %.1f). Starting Pump.", val, target)
                     self.add_log(f"Pumpe eingeschaltet (Bodenfeuchte {val}% < {target}%)")
                     await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": pump_entity})
                     self.pump_start_time = now
            except ValueError:
                pass

    async def _async_update_climate_logic(self, now: datetime.datetime):
        temp_entity = self.config.get(CONF_TEMP_SENSOR)
        humid_entity = self.config.get(CONF_HUMIDITY_SENSOR)
        fan_entity = self.config.get(CONF_FAN_ENTITY)
        
        # Climate Settings
        # Climate Settings (Recipe Override)
        target_temp = self._get_recipe_value(self.current_phase, "target_temp", self._get_config_value(CONF_TARGET_TEMP, DEFAULT_TARGET_TEMP, float))
        target_humidity = self._get_recipe_value(self.current_phase, "target_humidity", self._get_config_value(CONF_TARGET_HUMIDITY, DEFAULT_TARGET_HUMIDITY, float))
        
        # Other settings
        min_humidity = self._get_config_value(CONF_MIN_HUMIDITY, DEFAULT_MIN_HUMIDITY, float)
        max_humidity = self._get_config_value(CONF_MAX_HUMIDITY, DEFAULT_MAX_HUMIDITY, float)
        # Use target_humidity if recipe set it, otherwise max_humidity
        if target_humidity > max_humidity:
             max_humidity = target_humidity + 5
             
        humidity_hysteresis = self._get_config_value(CONF_HUMIDITY_HYSTERESIS, DEFAULT_HUMIDITY_HYSTERESIS, float)
        temp_hysteresis = self._get_config_value(CONF_TEMP_HYSTERESIS, DEFAULT_TEMP_HYSTERESIS, float)
        fan_hysteresis = self._get_config_value(CONF_FAN_HYSTERESIS, DEFAULT_FAN_HYSTERESIS, float)
        
        humidifier_entity = self.config.get(CONF_HUMIDIFIER_ENTITY)

        temp_state = self._get_safe_state(temp_entity)
        humid_state = self._get_safe_state(humid_entity)

        if not temp_state or not humid_state:
             if not temp_state: _LOGGER.debug("Climate logic halted: Temp sensor %s not ready", temp_entity)
             if not humid_state: _LOGGER.debug("Climate logic halted: Humidity sensor %s not ready", humid_entity)
             return

        try:
            current_temp = float(temp_state.state)
            current_humid = float(humid_state.state)
        except ValueError:
            return

        if fan_entity:
            fan_state = self._get_safe_state(fan_entity)
            if fan_state:
                is_fan_on = fan_state.state == "on"
                should_fan_on = False

                if current_temp > target_temp or current_humid > max_humidity:
                    should_fan_on = True
                elif current_temp < (target_temp - temp_hysteresis) and current_humid < (max_humidity - fan_hysteresis):
                    should_fan_on = False
                else:
                     should_fan_on = is_fan_on

                if should_fan_on and not is_fan_on:
                     self.add_log(f"Abluft eingeschaltet (T={current_temp}°, H={current_humid}%)")
                     await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": fan_entity})
                elif not should_fan_on and is_fan_on:
                     self.add_log(f"Abluft ausgeschaltet (T={current_temp}°, H={current_humid}%)")
                     await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": fan_entity})

        # Humidifier Pulse Logic
        if not humidifier_entity:
            return

        humidifier_state = self._get_safe_state(humidifier_entity)
        if not humidifier_state:
            return

        is_humidifier_on = humidifier_state.state not in ["off", "unavailable", "unknown"]

        if is_humidifier_on:
             if current_humid >= target_humidity:
                  _LOGGER.info("Humidity reached target (%.1f >= %.1f). Turning OFF.", current_humid, target_humidity)
                  self.add_log(f"Luftbefeuchter ausgeschaltet (H={current_humid}% >= {target_humidity}%)")
                  await self.hass.services.async_call("homeassistant", "turn_off", {"entity_id": humidifier_entity})
                  self.last_humidifier_stop_time = now
                  self.humidifier_start_time = None
        else:
             # Humidifier is OFF
             self.humidifier_start_time = None
             
             # Soak Time Check (10 min)
             if self.last_humidifier_stop_time:
                 time_off = (now - self.last_humidifier_stop_time).total_seconds()
                 if time_off < 600: # 600s = 10 min
                      return

             # Sensor Check
             # Humidifier starts at target - hysteresis
             start_threshold = target_humidity - humidity_hysteresis
             if current_humid < start_threshold:
                  _LOGGER.info("Humidity low (%.1f < %.1f). Starting Humidifier.", current_humid, start_threshold)
                  self.add_log(f"Luftbefeuchter eingeschaltet (H={current_humid}% < {start_threshold}%)")
                  await self.hass.services.async_call("homeassistant", "turn_on", {"entity_id": humidifier_entity})
                  self.humidifier_start_time = now


    def set_master_switch(self, state: bool):
        self.master_switch_on = state
        self.hass.async_create_task(self._async_update_logic(dt_util.now()))

    def _get_vpd_target_range(self, phase: str) -> tuple[float, float]:
        """Get ideal VPD range for a specific growth phase (in kPa)."""
        # Check Recipe first
        recipe_range = self._get_recipe_value(phase, "vpd_range", None)
        if recipe_range and isinstance(recipe_range, list) and len(recipe_range) == 2:
            return (float(recipe_range[0]), float(recipe_range[1]))

        # Fallback to defaults
        ranges = {
            PHASE_SEEDLING: (0.4, 0.8),
            PHASE_VEGETATIVE: (0.8, 1.2),
            PHASE_FLOWERING: (1.2, 1.6),
            PHASE_DRYING: (0.8, 1.0),
            PHASE_CURING: (0.5, 0.7),
        }
        return ranges.get(phase, (0.8, 1.2)) # Default to vegetative

    def _get_recipe_value(self, phase: str, key: str, default: Any) -> Any:
        """Get a value from the active recipe for the current phase."""
        recipe = self.config.get(CONF_ACTIVE_RECIPE)
        if not recipe or not isinstance(recipe, dict):
            return default
            
        phases = recipe.get("phases", {})
        phase_config = phases.get(phase, {})
        
        # We look for the key in the phase-specific config
        if key in phase_config:
            return phase_config[key]
            
        return default

    def set_phase(self, phase: str):
        self.current_phase = phase
        self.hass.async_create_task(self._async_update_logic(dt_util.now()))

    async def _async_take_snapshot(self, grow_id: str, manual: bool = False):
        """Take a snapshot from the configured camera for a specific grow."""
        cam_entity = self.config.get(CONF_CAMERA_ENTITY)
        if not cam_entity:
            return
            
        active_grow = next((g for g in self.grows if g["id"] == grow_id), None)
        if not active_grow:
            return
            
        # Ensure directories exist
        base_path = self.hass.config.path("www", "local_grow_box_images", "grows", grow_id)
        if not os.path.exists(base_path):
            try:
                os.makedirs(base_path, exist_ok=True)
            except Exception as e:
                _LOGGER.error("Failed to create snapshot directory: %s", e)
                return

        # Generate filename
        timestamp = dt_util.now()
        filename = f"{timestamp.date().isoformat()}.jpg"
        if manual:
            filename = f"{timestamp.strftime('%Y-%m-%d_%H-%M-%S')}.jpg"
            
        full_path = os.path.join(base_path, filename)
        
        try:
            await self.hass.services.async_call(
                "camera", 
                "snapshot", 
                {"entity_id": cam_entity, "filename": full_path},
                blocking=True
            )
            
            # Update grow record
            if "photos" not in active_grow:
                active_grow["photos"] = []
            
            if filename not in active_grow["photos"]:
                active_grow["photos"].append(filename)
                # Sort photos by date/time
                active_grow["photos"].sort()
                
            self.hass.async_add_executor_job(self._save_grows)
            _LOGGER.info("Snapshot saved for grow %s: %s", grow_id, filename)
            
        except Exception as e:
            _LOGGER.error("Failed to take snapshot: %s", e)

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    await hass.http.async_register_static_paths([
        StaticPathConfig("/local_grow_box", hass.config.path("custom_components/local_grow_box/frontend"), True)
    ])
    img_path = hass.config.path("www", "local_grow_box_images")
    if not os.path.exists(img_path):
        os.makedirs(img_path)
    await panel_custom.async_register_panel(
        hass, webcomponent_name="local-grow-box-panel", frontend_url_path="grow-room",
        module_url=f"/local_grow_box/local-grow-box-panel.js?v={int(dt_util.now().timestamp())}",
        sidebar_title="Grow Room", sidebar_icon="mdi:sprout", require_admin=False,
    )

    # Register Websocket API
    _LOGGER.debug("Registering Local Grow Box Websocket Commands")
    try:
        websocket_api.async_register_command(hass, ws_upload_image)
        websocket_api.async_register_command(hass, ws_update_config)
        websocket_api.async_register_command(hass, ws_get_config)
        websocket_api.async_register_command(hass, ws_get_logs)
        websocket_api.async_register_command(hass, ws_get_grows)
        websocket_api.async_register_command(hass, ws_start_grow)
        websocket_api.async_register_command(hass, ws_stop_grow)
        websocket_api.async_register_command(hass, ws_update_grow)
        websocket_api.async_register_command(hass, ws_delete_grow)
        websocket_api.async_register_command(hass, ws_add_grow_event)
    except Exception as e:
        _LOGGER.warning("Failed to register websocket commands in async_setup (might be duplicate): %s", e)
    
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    
    # FAILSAFE: Ensure commands are registered even if async_setup didn't run or failed
    try:
        websocket_api.async_register_command(hass, ws_upload_image)
        websocket_api.async_register_command(hass, ws_update_config)
        websocket_api.async_register_command(hass, ws_get_config)
        websocket_api.async_register_command(hass, ws_get_logs)
        websocket_api.async_register_command(hass, ws_get_grows)
        websocket_api.async_register_command(hass, ws_start_grow)
        websocket_api.async_register_command(hass, ws_stop_grow)
        websocket_api.async_register_command(hass, ws_update_grow)
        websocket_api.async_register_command(hass, ws_delete_grow)
        websocket_api.async_register_command(hass, ws_add_grow_event)
        websocket_api.async_register_command(hass, ws_reset_grow_energy)
        websocket_api.async_register_command(hass, ws_apply_recipe)
        websocket_api.async_register_command(hass, ws_take_snapshot)
    except Exception:
        pass # Expected if already registered

    manager = GrowBoxManager(hass, entry)
    hass.data[DOMAIN][entry.entry_id] = manager
    await manager.async_setup()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    manager = hass.data[DOMAIN].pop(entry.entry_id)
    manager.async_unload()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)

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

    # Check for phase change to update start date
    if "current_phase" in new_config:
        full_config = {**entry.data, **entry.options}
        current_phase = full_config.get("current_phase") if full_config else None
        
        if current_phase != new_config.get("current_phase"):
            # If phase changed and no start date provided, reset it
            if CONF_PHASE_START_DATE not in new_config:
                new_config[CONF_PHASE_START_DATE] = dt_util.now().isoformat()

    # Clean empty values
    # Clean None values, but ALLOW empty strings (to clear fields)
    clean = {k: v for k, v in new_config.items() if v is not None}
    opts = {**entry.options, **clean}
    
    hass.config_entries.async_update_entry(entry, options=opts)
    connection.send_result(msg["id"], {"options": opts})

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/upload_image",
    vol.Required("device_id"): str,
    vol.Optional("entry_id"): str,
    vol.Required("image"): str, # Base64 encoded
})
@websocket_api.async_response
async def ws_upload_image(hass, connection, msg):
    """Handle image upload."""
    device_id = msg["device_id"]
    entry_id = msg.get("entry_id")
    image_data = msg["image"]
    
    if "," in image_data:
        image_data = image_data.split(",")[1]

    try:
        decoded = base64.b64decode(image_data)
        img_path = hass.config.path("www", "local_grow_box_images", f"{device_id}.jpg")
        
        def _write_file():
            with open(img_path, "wb") as f:
                f.write(decoded)

        await hass.async_add_executor_job(_write_file)

        # Update config entry with version timestamp to bust cache
        try:
            timestamp = int(dt_util.now().timestamp())
            entry = None
            if entry_id:
                entry = hass.config_entries.async_get_entry(entry_id)
            
            # Fallback (though device_id is likely not the entry_id)
            if not entry:
                entry = hass.config_entries.async_get_entry(device_id)

            if entry:
                new_opts = {**entry.options, "image_version": timestamp}
                hass.config_entries.async_update_entry(entry, options=new_opts)
                
                # Update running manager immediately to avoid race condition
                if DOMAIN in hass.data and entry.entry_id in hass.data[DOMAIN]:
                    manager = hass.data[DOMAIN][entry.entry_id]
                    if hasattr(manager, 'config'):
                        manager.config["image_version"] = timestamp
            else:
                _LOGGER.warning("Upload: No entry found for device_id %s / entry_id %s", device_id, entry_id)
        except Exception as err:
            _LOGGER.error("Error updating config entry during upload: %s", err)
            # Default to current time if config update fails, so frontend at least tries to refresh
            timestamp = int(dt_util.now().timestamp())
            
        connection.send_result(msg["id"], {
            "path": f"/local/local_grow_box_images/{device_id}.jpg",
            "version": timestamp
        })
    except Exception as e:
        _LOGGER.error("Upload failed: %s", e)
        connection.send_error(msg["id"], "upload_failed", str(e))

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/get_config",
    vol.Required("entry_id"): str,
})
@websocket_api.async_response
async def ws_get_config(hass, connection, msg):
    """Handle config get."""
    entry_id = msg["entry_id"]
    entry = hass.config_entries.async_get_entry(entry_id)

    if not entry:
        connection.send_error(msg["id"], "not_found", "Entry not found")
        return

    data = {**entry.data, **entry.options}
    connection.send_result(msg["id"], {"config": data})

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/get_logs",
    vol.Required("entry_id"): str,
})
@websocket_api.async_response
async def ws_get_logs(hass, connection, msg):
    """Handle get logs."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        connection.send_result(msg["id"], {"logs": manager.logs})
    else:
        connection.send_result(msg["id"], {"logs": []})

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/get_grows",
    vol.Required("entry_id"): str,
})
@websocket_api.async_response
async def ws_get_grows(hass, connection, msg):
    """Handle get grows."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_result(msg["id"], {"grows": []})

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/start_grow",
    vol.Required("entry_id"): str,
    vol.Required("name"): str,
    vol.Optional("strain", default=""): str,
    vol.Optional("expected_weeks", default=8): int,
})
@websocket_api.async_response
async def ws_start_grow(hass, connection, msg):
    """Handle start grow."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        manager.start_grow(msg["name"], msg["strain"], msg["expected_weeks"])
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/stop_grow",
    vol.Required("entry_id"): str,
    vol.Required("grow_id"): str,
})
@websocket_api.async_response
async def ws_stop_grow(hass, connection, msg):
    """Handle stop grow."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        manager.stop_grow(msg["grow_id"])
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/update_grow",
    vol.Required("entry_id"): str,
    vol.Required("grow_id"): str,
    vol.Required("updates"): dict,
})
@websocket_api.async_response
async def ws_update_grow(hass, connection, msg):
    """Handle update grow."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        manager.update_grow(msg["grow_id"], msg["updates"])
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/delete_grow",
    vol.Required("entry_id"): str,
    vol.Required("grow_id"): str,
})
@websocket_api.async_response
async def ws_delete_grow(hass, connection, msg):
    """Handle delete grow."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        manager.delete_grow(msg["grow_id"])
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/reset_grow_energy",
    vol.Required("entry_id"): str,
    vol.Required("grow_id"): str,
})
@websocket_api.async_response
async def ws_reset_grow_energy(hass, connection, msg):
    """Handle reset grow energy."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        manager.reset_grow_energy(msg["grow_id"])
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/add_grow_event",
    vol.Required("entry_id"): str,
    vol.Required("grow_id"): str,
    vol.Required("event_type"): str,
    vol.Optional("note", default=""): str,
})
@websocket_api.async_response
async def ws_add_grow_event(hass, connection, msg):
    """Handle add grow event."""
    entry_id = msg["entry_id"]
    manager = hass.data[DOMAIN].get(entry_id)
    if manager:
        manager.add_grow_event(msg["grow_id"], msg["event_type"], msg["note"])
        connection.send_result(msg["id"], {"grows": manager.grows})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")
@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/apply_recipe",
    vol.Required("entry_id"): str,
    vol.Required("recipe"): vol.Any(dict, None),
})
@websocket_api.async_response
async def ws_apply_recipe(hass, connection, msg):
    """Apply a growth recipe to a config entry."""
    entry_id = msg["entry_id"]
    recipe = msg["recipe"]
    entry = hass.config_entries.async_get_entry(entry_id)

    if not entry:
        connection.send_error(msg["id"], "not_found", "Entry not found")
        return

    # Update options with the new recipe
    new_options = {**entry.options, CONF_ACTIVE_RECIPE: recipe}
    hass.config_entries.async_update_entry(entry, options=new_options)
    
    # Also update the running manager's config immediately
    if DOMAIN in hass.data and entry_id in hass.data[DOMAIN]:
        hass.data[DOMAIN][entry_id].config = {**hass.data[DOMAIN][entry_id].config, CONF_ACTIVE_RECIPE: recipe}
    
    connection.send_result(msg["id"], {"recipe": recipe})

@websocket_api.websocket_command({
    vol.Required("type"): "local_grow_box/take_snapshot",
    vol.Required("entry_id"): str,
    vol.Required("grow_id"): str,
})
@websocket_api.async_response
async def ws_take_snapshot(hass, connection, msg):
    """Manually trigger a snapshot for a grow."""
    entry_id = msg["entry_id"]
    grow_id = msg["grow_id"]
    
    if DOMAIN in hass.data and entry_id in hass.data[DOMAIN]:
        manager = hass.data[DOMAIN][entry_id]
        await manager._async_take_snapshot(grow_id, manual=True)
        connection.send_result(msg["id"], {"success": True})
    else:
        connection.send_error(msg["id"], "not_found", "Manager not found")
