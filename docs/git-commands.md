# Git Commands Reference

## Push Changes to GitHub

```bash
# 1. Check what files have changed
git status

# 2. Stage all changes
git add .

# OR stage specific files
git add path/to/file.ts

# 3. Commit with a message
git commit -m "your commit message here"

# 4. Push to GitHub
git push

# If pushing a new branch for the first time
git push -u origin branch-name
```

## Pull Changes from GitHub

```bash
# Pull latest changes from the current branch
git pull

# Pull from a specific branch
git pull origin branch-name
```

## Useful Supporting Commands

```bash
# Check current branch
git branch

# Switch to an existing branch
git checkout branch-name

# Create and switch to a new branch
git checkout -b new-branch-name

# View recent commit history
git log --oneline -10

```
