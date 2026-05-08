#!/bin/sh
set -eu

if [ ! -d /repo/.git ]; then
  git clone --depth 1 --branch main https://github.com/gastownhall/gascity.git /repo
else
  git -C /repo fetch --depth 1 origin main
  git -C /repo reset --hard origin/main
  git -C /repo clean -fdx
fi
