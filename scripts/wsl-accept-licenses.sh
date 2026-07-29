#!/bin/bash
export ANDROID_HOME=/home/kevin/Android/Sdk
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses
