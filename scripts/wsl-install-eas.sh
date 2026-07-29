#!/bin/bash
set -e
export PATH="/usr/local/bin:$PATH"
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
npm install -g eas-cli
echo "---"
"$HOME/.npm-global/bin/eas" --version
