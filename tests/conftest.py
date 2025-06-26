"""
Pytest configuration for ranked choice voting tests.
"""

import pytest
import os


def pytest_configure(config):
    """Configure pytest environment."""
    # Set environment variables for testing
    os.environ.setdefault("POSTGRES_USER", os.getenv("USER", "postgres"))
    os.environ.setdefault("POSTGRES_PASSWORD", "")
    os.environ.setdefault("POSTGRES_HOST", "localhost")
    os.environ.setdefault("POSTGRES_PORT", "5432")


def pytest_addoption(parser):
    """Add custom command line options."""
    parser.addoption(
        "--postgres-user",
        action="store",
        default=os.getenv("USER", "postgres"),
        help="PostgreSQL username for test database"
    )
    parser.addoption(
        "--postgres-password", 
        action="store",
        default="",
        help="PostgreSQL password for test database"
    )
    parser.addoption(
        "--postgres-host",
        action="store", 
        default="localhost",
        help="PostgreSQL host for test database"
    )


@pytest.fixture(scope="session", autouse=True)
def configure_test_environment(request):
    """Configure test environment from command line options."""
    os.environ["POSTGRES_USER"] = request.config.getoption("--postgres-user")
    os.environ["POSTGRES_PASSWORD"] = request.config.getoption("--postgres-password") 
    os.environ["POSTGRES_HOST"] = request.config.getoption("--postgres-host")