import { IntlProvider } from "react-intl";
import type { ReactNode } from "react";

import enUSMessages from "./compiled/en-US.json";

export const DEFAULT_LOCALE = "en-US";

export const messagesByLocale = {
  [DEFAULT_LOCALE]: enUSMessages,
} as const;

export type SupportedLocale = keyof typeof messagesByLocale;

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return Object.hasOwn(messagesByLocale, locale);
}

export function resolveSupportedLocale(locale: string | undefined): SupportedLocale {
  if (locale && isSupportedLocale(locale)) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

export function VibeIntlProvider({ children, locale = DEFAULT_LOCALE }: { children: ReactNode; locale?: string }) {
  const resolvedLocale = resolveSupportedLocale(locale);

  return (
    <IntlProvider
      defaultLocale={DEFAULT_LOCALE}
      locale={resolvedLocale}
      messages={messagesByLocale[resolvedLocale]}
    >
      {children}
    </IntlProvider>
  );
}
