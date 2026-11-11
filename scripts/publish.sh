#!/usr/bin/env bash
# One-time setup: create the GitHub repo, push, and turn on GitHub Pages.
# Needs the GitHub CLI (https://cli.github.com) and `gh auth login` done once.
# Usage: scripts/publish.sh [repo-name] [public|private]
set -euo pipefail
NAME="${1:-metascrub}"
VIS="${2:-public}"   # GitHub Pages is free for public repos; private repos need a paid plan

gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }

if [ ! -d .git ]; then
  git init -b main
fi
git add -A
git diff --cached --quiet || git commit -m "MetaScrub: initial commit"

if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$NAME" --"$VIS" --source=. --remote=origin --push \
    --description "See and remove hidden metadata from photos, videos and documents, 100% in your browser."
else
  git push -u origin main
fi

OWNER="$(gh api user -q .login)"
# Turn on Pages (deploy from main branch, root folder). Ignore "already enabled".
gh api -X POST "repos/$OWNER/$NAME/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
gh repo edit "$OWNER/$NAME" --homepage "https://$OWNER.github.io/$NAME/" --add-topic privacy --add-topic metadata --add-topic exif >/dev/null 2>&1 || true

echo
echo "Repo:  https://github.com/$OWNER/$NAME"
echo "Site:  https://$OWNER.github.io/$NAME/   (first deploy takes about a minute)"
