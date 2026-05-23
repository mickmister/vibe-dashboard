import React, { useEffect, useRef } from 'react';
import { StatusBar, StyleSheet } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { SpringboardProviderPure } from 'springboard/engine/engine';
import {
  createReactNativeRemoteServices,
  SpringboardExpoWebViewHost,
  useAndInitializeSpringboardEngine,
} from 'springboard/platforms/react-native/entrypoints/rn_app_springboard_entrypoint';

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

  const content = !sbInitResult?.engine || !sbInitResult?.handleMessageFromWebview
    ? null
    : LOAD_WEBVIEW_FROM_SITE_URL
      ? (
        <SiteUrlWebViewHost
          siteUrl={DATA_HOST}
          handleMessageFromWebview={sbInitResult.handleMessageFromWebview}
          onMessageFromRN={(cb) => {
            onMessageFromRN.current = cb;
          }}
        />
      )
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

type SiteUrlWebViewHostProps = {
  siteUrl: string;
  handleMessageFromWebview: (message: string) => void;
  onMessageFromRN: (cb: (message: string) => void) => void;
};

const SiteUrlWebViewHost = ({
  siteUrl,
  handleMessageFromWebview,
  onMessageFromRN,
}: SiteUrlWebViewHostProps) => {
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    onMessageFromRN((message) => {
      webViewRef.current?.injectJavaScript(`window.receiveMessageFromRN(${JSON.stringify(message)}); true;`);
    });
  }, [onMessageFromRN]);

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: siteUrl }}
      onLoadEnd={() => {
        void SplashScreen.hideAsync();
      }}
      onMessage={(event: { nativeEvent: { data: string } }) => {
        handleMessageFromWebview(event.nativeEvent.data);
      }}
      originWhitelist={['*']}
      style={styles.webview}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      webviewDebuggingEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      allowsAirPlayForMediaPlayback
      allowsBackForwardNavigationGestures
      allowsFullscreenVideo
      allowsProtectedMedia
      onContentProcessDidTerminate={() => {
        webViewRef.current?.reload();
      }}
      bounces={false}
      overScrollMode="never"
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});
