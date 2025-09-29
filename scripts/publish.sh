#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting publish workflow...${NC}"

# Function to check if there are uncommitted changes
check_uncommitted_changes() {
    if [[ -n $(git status --porcelain) ]]; then
        return 0
    else
        return 1
    fi
}

# Function to get the last migration applied to production
get_last_prod_migration() {
    # This will be tracked in a file or we can query the production database
    if [ -f ".last-prod-migration" ]; then
        cat .last-prod-migration
    else
        echo "000"
    fi
}

# Function to get new migrations since last production push
get_new_migrations() {
    local last_migration=$1
    find database/migrations -name "*_up.sql" -type f | sort | while read -r migration; do
        migration_num=$(basename "$migration" | cut -d'_' -f1)
        if [[ "$migration_num" > "$last_migration" ]]; then
            echo "$migration"
        fi
    done
}

# 1. Check current branch
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${BLUE}Current branch: ${CURRENT_BRANCH}${NC}"

if [ "$CURRENT_BRANCH" == "main" ]; then
    echo -e "${RED}❌ You are already on main branch. Please work on a feature branch.${NC}"
    exit 1
fi

# 2. Check for uncommitted changes and commit if needed
if check_uncommitted_changes; then
    echo -e "${YELLOW}📝 Uncommitted changes detected. Creating commit...${NC}"

    # Show status
    git status --short

    # Add all changes
    git add -A

    # Create commit message
    read -p "Enter commit message (or press Enter for auto-generated): " commit_msg

    if [ -z "$commit_msg" ]; then
        commit_msg="Deploy updates from $CURRENT_BRANCH"
    fi

    # Commit with co-author
    git commit -m "$(cat <<EOF
$commit_msg

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
    )"

    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Commit failed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Changes committed${NC}"
else
    echo -e "${GREEN}✅ No uncommitted changes${NC}"
fi

# 3. Push current branch
echo -e "${BLUE}📤 Pushing $CURRENT_BRANCH...${NC}"
git push origin "$CURRENT_BRANCH" 2>/dev/null || git push -u origin "$CURRENT_BRANCH"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to push $CURRENT_BRANCH${NC}"
    exit 1
fi

# 4. Checkout main and pull latest
echo -e "${BLUE}🔄 Switching to main branch...${NC}"
git checkout main

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to checkout main${NC}"
    exit 1
fi

echo -e "${BLUE}📥 Pulling latest main...${NC}"
git pull origin main

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to pull main${NC}"
    exit 1
fi

# 5. Merge feature branch
echo -e "${BLUE}🔀 Merging $CURRENT_BRANCH into main...${NC}"
git merge "$CURRENT_BRANCH" --no-ff -m "Merge branch '$CURRENT_BRANCH' into main

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Merge failed. Please resolve conflicts manually.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Merge successful${NC}"

# 6. Check for new database migrations
echo -e "${BLUE}🔍 Checking for database migrations...${NC}"

LAST_PROD_MIGRATION=$(get_last_prod_migration)
NEW_MIGRATIONS=$(get_new_migrations "$LAST_PROD_MIGRATION")

if [ -n "$NEW_MIGRATIONS" ]; then
    echo -e "${YELLOW}📊 Found new migrations to apply:${NC}"
    echo "$NEW_MIGRATIONS"

    read -p "Apply these migrations to production database? (y/n): " apply_migrations

    if [ "$apply_migrations" == "y" ]; then
        echo -e "${BLUE}🚀 Applying migrations to production...${NC}"

        # Apply migrations using the production migration script
        npm run db:migrate:production

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Migrations applied successfully${NC}"

            # Update the last migration marker
            highest_migration=$(echo "$NEW_MIGRATIONS" | tail -1 | xargs basename | cut -d'_' -f1)
            echo "$highest_migration" > .last-prod-migration

            # Commit the migration marker
            git add .last-prod-migration
            git commit -m "Update last production migration marker to $highest_migration" 2>/dev/null
        else
            echo -e "${RED}⚠️  Migration failed. Main branch pushed but database not updated.${NC}"
            echo -e "${YELLOW}Run 'npm run db:migrate:production' manually to apply migrations.${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Skipping database migrations. Remember to run them manually!${NC}"
    fi
else
    echo -e "${GREEN}✅ No new database migrations needed${NC}"
fi

# 7. Push main to origin
echo -e "${BLUE}📤 Pushing main to origin...${NC}"
git push origin main

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to push main${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Successfully pushed to main${NC}"

# 8. Optionally delete the feature branch
read -p "Delete local branch '$CURRENT_BRANCH'? (y/n): " delete_branch
if [ "$delete_branch" == "y" ]; then
    git branch -d "$CURRENT_BRANCH"
    echo -e "${GREEN}✅ Deleted local branch $CURRENT_BRANCH${NC}"

    read -p "Delete remote branch '$CURRENT_BRANCH'? (y/n): " delete_remote
    if [ "$delete_remote" == "y" ]; then
        git push origin --delete "$CURRENT_BRANCH"
        echo -e "${GREEN}✅ Deleted remote branch $CURRENT_BRANCH${NC}"
    fi
fi

echo -e "${GREEN}🎉 Publish complete!${NC}"
echo -e "${BLUE}📝 Summary:${NC}"
echo -e "  • Merged $CURRENT_BRANCH into main"
echo -e "  • Pushed main to origin"
if [ -n "$NEW_MIGRATIONS" ] && [ "$apply_migrations" == "y" ]; then
    echo -e "  • Applied database migrations to production"
fi
echo -e "${BLUE}🌐 Your changes should be live soon!${NC}"