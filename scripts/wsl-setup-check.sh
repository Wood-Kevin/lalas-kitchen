#!/bin/bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/home/kevin/Android/Sdk
export PATH="$HOME/.local/bin:$PATH:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

echo "ANDROID_HOME=$ANDROID_HOME"
which node
which eas
echo "---eas whoami---"
eas whoami
