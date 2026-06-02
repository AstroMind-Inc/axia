import logging
from datetime import datetime
from typing import Any, Dict, Optional
from pythonjsonlogger import jsonlogger
from src.core.settings import get_settings

DATE_FORMAT_TIMEZONE = "%Y-%m-%dT%H:%M:%S.%fZ"


class JsonFormatter(jsonlogger.JsonFormatter):
    """
    Custom JSON formatter for logging with additional fields.

    This formatter extends the base JSON formatter to include standardized fields
    and handling of extra attributes with a specific prefix.

    Attributes:
        EXTRA_PREFIX: Prefix used to identify extra logging attributes
        component: Name of the component for logging context
    """

    EXTRA_PREFIX = "extra_"

    def __init__(self, component: str, **kwargs):
        self.component = component
        super().__init__(**kwargs)

    def add_fields(
            self,
            log_record: Dict[str, Any],
            record: logging.LogRecord,
            message_dict: Dict[str, Any]
    ) -> None:
        """
        Add custom fields to the log record.

        Args:
            log_record: The log record to be modified
            record: The original logging record
            message_dict: Additional message dictionary
        """
        super().add_fields(log_record, record, message_dict)

        # Add timestamp in UTC
        if not log_record.get("timestamp"):
            now = datetime.utcnow().strftime(DATE_FORMAT_TIMEZONE)
            log_record["timestamp"] = now

        # Add standard context fields
        log_record.update({
            "level": record.levelname,
            "type": "log",
            "level_num": record.levelno,
            "logger_name": record.name,
            "component": self.component
        })

        # Process extra attributes from the record
        for key, value in record.__dict__.items():
            if key.startswith(self.EXTRA_PREFIX):
                log_record[key.replace(self.EXTRA_PREFIX, "")] = value


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the specified name.

    Args:
        name: The name for the logger instance

    Returns:
        logging.Logger: Configured logger instance
    """
    return logging.getLogger(name)


def setup_logger(
        component: Optional[str] = None,
        log_format: Optional[str] = None
) -> logging.Logger:
    """
    Initialize and configure the application logger.

    This function sets up a JSON-formatted logger with appropriate configuration
    based on application settings. It ensures consistent logging across the
    application with standardized formatting and fields.

    Args:
        component: Optional component name for logging context
        log_format: Optional custom log format string

    Returns:
        logging.Logger: Configured root logger instance
    """
    settings = get_settings()

    component = component or "axia-service"

    debug = bool(settings.service_debug)

    # Get root logger
    logger = logging.getLogger()

    # Remove existing handlers
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # Configure logging level
    level = logging.DEBUG if debug else logging.INFO
    logger.setLevel(level)

    # Setup console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)

    # Configure formatter
    formatter_kwargs = {}
    if log_format:
        formatter_kwargs['fmt'] = log_format

    formatter = JsonFormatter(component, **formatter_kwargs)
    console_handler.setFormatter(formatter)

    # Add handler to logger
    logger.addHandler(console_handler)

    # Log initialization
    logger.debug(
        "Logger initialization complete",
        extra={
            f"{JsonFormatter.EXTRA_PREFIX}component": component,
            f"{JsonFormatter.EXTRA_PREFIX}debug_enabled": debug,
            f"{JsonFormatter.EXTRA_PREFIX}log_level": logging.getLevelName(level)
        }
    )

    return logger


def get_logger_with_extras(**extra_fields) -> logging.Logger:
    """
    Get a logger instance with predefined extra fields.

    This utility function creates a logger with extra fields that will be
    included in all log messages.

    Args:
        **extra_fields: Keyword arguments for extra fields to include in logs

    Returns:
        logging.Logger: Logger instance with extra fields configured
    """
    logger = logging.getLogger()

    # Add EXTRA_PREFIX to all field names
    extra_fields = {
        f"{JsonFormatter.EXTRA_PREFIX}{key}": value
        for key, value in extra_fields.items()
    }

    # Create adapter with extra fields
    return logging.LoggerAdapter(logger, extra_fields)