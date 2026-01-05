import type { AppProps } from "next/app";

// Global UI styles (card-based layout)
import "../src/styles/styles.css";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
