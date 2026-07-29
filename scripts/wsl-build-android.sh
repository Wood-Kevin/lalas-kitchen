#!/bin/bash
set -e
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/home/kevin/Android/Sdk
export PATH="/usr/local/bin:$PATH:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

rm -rf "$HOME/lalas-kitchen-build"
git clone /mnt/c/Users/kevin/Desktop/claude-projects/lalas-kitchen "$HOME/lalas-kitchen-build"
cd "$HOME/lalas-kitchen-build"
npm install
eas build --platform android --profile production --local --non-interactive
