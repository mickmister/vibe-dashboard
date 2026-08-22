import React, { useEffect, useRef } from 'react';
import { StatusBar, StyleSheet } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SpringboardProviderPure } from 'springboard/engine/engine';
import {
  createReactNativeRemoteServices,
  SpringboardExpoWebViewHost,
  useAndInitializeSpringboardEngine,
} from 'springboard/platforms/react-native/entrypoints/rn_app_springboard_entrypoint';

import { ChatViewPage } from './ChatViewPage';
import initializeRNSpringboardEngine from './app/entrypoints/rn_init_module';

const DATA_HOST = process.env.EXPO_PUBLIC_SITE_URL || 'http://127.0.0.1:1337';
const LOAD_WEBVIEW_FROM_SITE_URL = Constants.expoConfig?.extra?.loadWebViewFromSiteUrl === true;

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

  return <MobileMain sbInitResult={sbInitResult} />;

  // return WebviewMain(sbInitResult, onMessageFromRN);
}

const MobileMain = (_props: { sbInitResult: ReturnType<typeof useAndInitializeSpringboardEngine> }) => {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ChatViewPage />
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

const WebviewMain = (sbInitResult: ReturnType<typeof useAndInitializeSpringboardEngine>, onMessageFromRN: ReturnType<typeof useRef<((message: string) => void) | null>>) => {
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
        siteUrl={DATA_HOST}
        loadFromSiteUrl={LOAD_WEBVIEW_FROM_SITE_URL}
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
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
