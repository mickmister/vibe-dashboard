import React, { useRef } from 'react';
import { StatusBar, StyleSheet } from 'react-native';

import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SpringboardProviderPure } from 'springboard/engine/engine';
import {
  createReactNativeRemoteServices,
  SpringboardExpoWebViewHost,
  useAndInitializeSpringboardEngine,
} from 'springboard/platforms/react-native/entrypoints/rn_app_springboard_entrypoint';

import initializeRNSpringboardEngine from './app/entrypoints/rn_init_module';

const DATA_HOST = process.env.EXPO_PUBLIC_SITE_URL || 'http://127.0.0.1:1337';

void SplashScreen.preventAutoHideAsync();

const { remoteRpc, remoteKv } = createReactNativeRemoteServices(DATA_HOST);

export default function App() {
  const onMessageFromRN = useRef<((message: string) => void) | null>(null);

  const sbInitResult = useAndInitializeSpringboardEngine({
    applicationEntrypoint: initializeRNSpringboardEngine,
    asyncStorageDependency: AsyncStorage,
    onMessageFromRN: (message) => {
      onMessageFromRN.current?.(message);
    },
    remoteKv,
    remoteRpc,
  });

  const content = !sbInitResult?.engine || !sbInitResult?.handleMessageFromWebview
    ? null
    : (
      <SpringboardExpoWebViewHost
        engine={sbInitResult.engine}
        assetModules={{
          html: require('./assets/web/index.html'),
          css: require('./assets/web/index-css.css'),
          js: require('./assets/web/index-js.js.asset'),
        }}
        handleMessageFromWebview={sbInitResult.handleMessageFromWebview}
        onMessageFromRN={(cb) => {
          onMessageFromRN.current = cb;
        }}
      />
    );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar hidden />
        {sbInitResult?.engine ? (
          <SpringboardProviderPure engine={sbInitResult.engine}>
            {content}
          </SpringboardProviderPure>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
