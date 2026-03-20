FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files first for better layer caching
COPY pyproject.toml uv.lock* ./

# Install dependencies using uv (frozen if lock file exists, otherwise resolve)
RUN if [ -f uv.lock ]; then uv sync --frozen --no-dev; else uv sync --no-dev; fi

# Copy application code
COPY . .

# Run in production mode with multiple workers
# Workers = 2 (conservative for 1GB droplet)
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
