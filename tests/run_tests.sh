#!/bin/bash
# Convenient script to run the ranked choice voting tests

set -e

echo "🗳️  Ranked Choice Voting Test Suite"
echo "=================================="

# Check if PostgreSQL is running
PG_READY="/opt/homebrew/opt/postgresql@15/bin/pg_isready"
if ! $PG_READY -h localhost -p 5432 >/dev/null 2>&1; then
    echo "❌ PostgreSQL is not running or not accessible"
    echo "Please start PostgreSQL and ensure it's accessible at localhost:5432"
    exit 1
fi

echo "✅ PostgreSQL is running"

# Check if test dependencies are installed
if ! python -c "import pytest, psycopg2" >/dev/null 2>&1; then
    echo "📦 Installing test dependencies..."
    pip install -r requirements.txt
fi

echo "✅ Dependencies are installed"

# Run the tests
echo ""
echo "🧪 Running ranked choice voting tests..."
echo ""

# Run with verbose output and colored results
python -m pytest test_ranked_choice_voting.py -v --tb=short --color=yes

echo ""
echo "✅ All tests completed!"