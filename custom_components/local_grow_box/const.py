"""Constants for the Local Grow Box integration."""

DOMAIN = "local_grow_box"

CONF_LIGHT_ENTITY = "light_entity"
CONF_FAN_ENTITY = "fan_entity"
CONF_PUMP_ENTITY = "pump_entity"
CONF_TEMP_SENSOR = "temp_sensor"
CONF_HUMIDITY_SENSOR = "humidity_sensor"
CONF_TARGET_TEMP = "target_temp"
CONF_MAX_HUMIDITY = "max_humidity"

# Grow Phases
PHASE_SEEDLING = "seedling"
PHASE_VEGETATIVE = "vegetative"
PHASE_FLOWERING = "flowering"
PHASE_DRYING = "drying"
PHASE_CURING = "curing"

GROW_PHASES = [
    PHASE_SEEDLING,
    PHASE_VEGETATIVE,
    PHASE_FLOWERING,
    PHASE_DRYING,
    PHASE_CURING,
]

# Defaults
DEFAULT_TARGET_TEMP = 24.0
DEFAULT_MAX_HUMIDITY = 60.0

# Phase Defaults (Hours of Light) - can be made configurable later
PHASE_LIGHT_HOURS = {
    PHASE_SEEDLING: 18,
    PHASE_VEGETATIVE: 18,
    PHASE_FLOWERING: 12,
    PHASE_DRYING: 0,
}
