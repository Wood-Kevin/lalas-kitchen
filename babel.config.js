module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must be listed last per react-native-reanimated's setup requirement.
    plugins: ['react-native-reanimated/plugin'],
  };
};
