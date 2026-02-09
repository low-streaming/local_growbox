"""Config flow for Local Grow Box integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import DOMAIN, CONF_LIGHT_ENTITY, CONF_FAN_ENTITY, CONF_TEMP_SENSOR, CONF_HUMIDITY_SENSOR

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
        vol.Required(CONF_TEMP_SENSOR): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor", device_class="temperature")
        ),
        vol.Required(CONF_HUMIDITY_SENSOR): selector.EntitySelector(
            selector.EntitySelectorConfig(domain="sensor", device_class="humidity")
        ),
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
        
        return self.async_create_entry(title=user_input["name"], data=user_input)
