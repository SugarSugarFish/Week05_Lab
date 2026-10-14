#!/usr/bin/env bash
# ---------------------------------------------------------------
# Week05 pendulum experiment - Git baseline lock / self-check
# Run from anywhere:   bash week05_pendulum_sim/build.sh
# Idempotent: if the baseline already exists it only reports state.
# ---------------------------------------------------------------
set -e
cd "$(dirname "$0")/.."

echo "[1/4] Checking repository..."
if [ ! -d .git ]; then
  echo "      no .git found - running git init"
  git init -b main
else
  echo "      .git found - reusing existing repository"
  git config user.name "Yang Minghui"
  git config user.email "5702126059@course.local"
fi

echo "[2/4] Staging files..."
git add .

echo "[3/4] Committing if there is anything new..."
git commit -m "feat(week05): init pendulum experiment workspace" || \
  echo "      nothing new to commit - baseline already locked"

echo "[4/4] Reporting state..."
echo
echo "------------------ RESULT ------------------"
git log --oneline -1
echo
git status
echo
git ls-files
echo "--------------------------------------------"
echo "Expected baseline: HEAD - feat(week05): init pendulum experiment workspace"
echo "Expected status:   nothing to commit, working tree clean"
