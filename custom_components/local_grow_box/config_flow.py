"""Config flow for Local Grow Box integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    DOMAIN, 
    CONF_LIGHT_ENTITY, 
    CONF_FAN_ENTITY, 
    CONF_PUMP_ENTITY,
    CONF_CAMERA_ENTITY,
    CONF_TEMP_SENSOR, 
    CONF_HUMIDITY_SENSOR,
    CONF_TARGET_TEMP,
    CONF_MAX_HUMIDITY,
)

_LOGGER = logging.getLogger(__name__)

# Schema for the initial setup
STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("name", default="My Grow Box"): str,
        vol.Required(CONF_LIGHT_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain=["switch", "light"])
        ),
        vol.Required(CONF_FAN_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain=["switch", "fan"])
        ),
        vol.Optional(CONF_PUMP_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain=["switch"])
        ),
        vol.Optional(CONF_CAMERA_ENTITY): selector.EntitySelector(
            selector.EntitySelectorConfig(domain=["camera"])
        ),
        vol.Required(CONF_TEMP_SENSOR): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor", device_class="temperature")
        ),
        vol.Required(CONF_HUMIDITY_SENSOR): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor", device_class="humidity")
        ),
        vol.Optional(CONF_TARGET_TEMP, default=24.0): vol.Coerce(float),
        vol.Optional(CONF_MAX_HUMIDITY, default=60.0): vol.Coerce(float),
    }
)

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Local Grow Box."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        if user_input is None:
            return self.async_show_form(
                step_id="user", data_schema=STEP_USER_DATA_SCHEMA
            )

        # In a real scenario, you might want to validate the entities here
        # or check for duplicates. For now, we just create the entry.
        
    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Create the options flow."""
        return OptionsFlowHandler(config_entry)


class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handle options flow for Local Grow Box."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        # Get current config (options prefer over data)
        config = {**self.config_entry.data, **self.config_entry.options}

        options_schema = vol.Schema(
            {
                vol.Required(
                    CONF_LIGHT_ENTITY, 
                    default=config.get(CONF_LIGHT_ENTITY)
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain=["switch", "light"])
                ),
                vol.Required(
                    CONF_FAN_ENTITY,
                    default=config.get(CONF_FAN_ENTITY)
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain=["switch", "fan"])
                ),
                vol.Optional(
                    CONF_PUMP_ENTITY,
                    default=config.get(CONF_PUMP_ENTITY)
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain=["switch"])
                ),
                vol.Optional(
                    CONF_CAMERA_ENTITY,
                    default=config.get(CONF_CAMERA_ENTITY)
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain=["camera"])
                ),
                vol.Required(
                    CONF_TEMP_SENSOR,
                    default=config.get(CONF_TEMP_SENSOR)
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain="sensor", device_class="temperature")
                ),
                vol.Required(
                    CONF_HUMIDITY_SENSOR,
                    default=config.get(CONF_HUMIDITY_SENSOR)
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain="sensor", device_class="humidity")
                ),
                vol.Optional(
                    CONF_TARGET_TEMP, 
                    default=config.get(CONF_TARGET_TEMP, 24.0)
                ): vol.Coerce(float),
                vol.Optional(
                    CONF_MAX_HUMIDITY, 
                    default=config.get(CONF_MAX_HUMIDITY, 60.0)
                ): vol.Coerce(float),
            }
        )

        return self.async_show_form(
            step_id="init", data_schema=options_schema
        )
